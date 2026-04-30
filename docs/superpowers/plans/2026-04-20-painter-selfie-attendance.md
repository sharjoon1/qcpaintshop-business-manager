# Painter Selfie Attendance + AP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace existing streak-only daily check-in with a selfie + 300m-geofence attendance system at QC branches, award 100 Attendance Points (AP) per check-in, and enable a month-end claim where painters can convert AP into regular points pool scaled by that month's customer billing (₹1,000 = 1%, capped 100% at ₹1 lakh).

**Architecture:** Three new MySQL tables (`painter_attendance_checkins`, `painter_attendance_monthly`, `painter_attendance_ledger`) + one clawback helper table. New `painter-attendance-service.js` with haversine validation and claim formula. Five painter API endpoints + four admin endpoints on `routes/painters.js`. Four cron jobs in `painter-scheduler.js` handle month rollover, claim window, forfeiture, and image purge. Android CheckInScreen rewritten with CameraX + GPS; new AttendanceHistoryScreen. Admin gets a new "Attendance" tab on `admin-painters.html`.

**Tech Stack:** Node.js + Express, MySQL (mysql2/promise), Multer, node-cron, Jest for tests, Jetpack Compose + CameraX + Retrofit for Android, vanilla JS + Tailwind for admin HTML.

**Spec:** `docs/superpowers/specs/2026-04-20-painter-selfie-attendance-design.md`

---

## File Structure

**Backend files created:**
- `migrations/migrate-painter-attendance.js` — DB migration
- `services/painter-attendance-service.js` — core logic (geofence, AP math, claim, clawback)
- `tests/unit/painter-attendance.test.js` — unit tests
- `tests/integration/painter-attendance-flow.test.js` — end-to-end flow tests

**Backend files modified:**
- `routes/painters.js` — add 5 painter endpoints + 4 admin endpoints
- `services/painter-scheduler.js` — add 4 cron jobs
- `services/painter-notification-service.js` — add 6 notification payloads
- `services/painter-points-engine.js` — net out `painter_clawback_pending` on every credit

**Admin web:**
- `public/admin-painters.html` — new Attendance tab

**Painter web (Phase-1 minimal):**
- `public/painter-dashboard.html` — AP row on hero card + claim button

**Android files created** (`qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/`):
- `network/AttendanceApi.kt` — Retrofit interface
- `ui/attendance/AttendanceHistoryScreen.kt`
- `ui/attendance/AttendanceViewModel.kt`

**Android files modified:**
- `ui/attendance/CheckInScreen.kt` — rewrite with CameraX + GPS
- `ui/attendance/CheckInViewModel.kt` — rewrite
- `ui/home/HomeScreen.kt` — HeroCard AP row
- `ui/home/HomeViewModel.kt` — fetch attendance summary
- `app/build.gradle` — add CameraX + Accompanist Permissions deps (if absent)
- `AndroidManifest.xml` — confirm CAMERA + ACCESS_FINE_LOCATION permissions

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-painter-attendance.js`

- [ ] **Step 1: Create migration file**

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

        console.log('Connected to database. Running painter attendance migration...\n');

        // 1. painter_attendance_checkins
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_checkins (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                branch_id INT NOT NULL,
                checkin_date DATE NOT NULL,
                checkin_at DATETIME NOT NULL,
                latitude DECIMAL(10,8) NOT NULL,
                longitude DECIMAL(11,8) NOT NULL,
                distance_meters INT NOT NULL,
                selfie_path VARCHAR(500) NOT NULL,
                status ENUM('approved','rejected') NOT NULL DEFAULT 'approved',
                rejected_at DATETIME NULL,
                rejected_reason VARCHAR(500) NULL,
                rejected_by INT NULL,
                points_awarded INT NOT NULL DEFAULT 100,
                month_key CHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(checkin_date, '%Y-%m')) VIRTUAL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_painter_day (painter_id, checkin_date),
                INDEX idx_month (painter_id, month_key),
                INDEX idx_branch_date (branch_id, checkin_date),
                INDEX idx_status_date (status, checkin_date),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_checkins created');

        // 2. painter_attendance_monthly
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_monthly (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                month_key CHAR(7) NOT NULL,
                total_checkins INT NOT NULL DEFAULT 0,
                total_ap_earned INT NOT NULL DEFAULT 0,
                monthly_customer_billed DECIMAL(12,2) NOT NULL DEFAULT 0,
                claim_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
                claimable_ap INT NOT NULL DEFAULT 0,
                ap_claimed INT NOT NULL DEFAULT 0,
                claim_status ENUM('pending','available','claimed','forfeited') NOT NULL DEFAULT 'pending',
                claim_window_opens_at DATETIME NULL,
                claim_window_closes_at DATETIME NULL,
                claimed_at DATETIME NULL,
                forfeited_at DATETIME NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_painter_month (painter_id, month_key),
                INDEX idx_status_month (claim_status, month_key),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_monthly created');

        // 3. painter_attendance_ledger
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_ledger (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                month_key CHAR(7) NOT NULL,
                checkin_id INT NULL,
                type ENUM('earn','claim','clawback','forfeit') NOT NULL,
                ap_delta INT NOT NULL,
                reason VARCHAR(500) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by INT NULL,
                INDEX idx_painter_month (painter_id, month_key),
                INDEX idx_type_created (type, created_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                FOREIGN KEY (checkin_id) REFERENCES painter_attendance_checkins(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_ledger created');

        // 4. painter_clawback_pending
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_clawback_pending (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                amount INT NOT NULL,
                reason VARCHAR(500) NULL,
                source VARCHAR(50) NOT NULL DEFAULT 'attendance',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                settled_at DATETIME NULL,
                settled_ledger_id INT NULL,
                INDEX idx_painter_unsettled (painter_id, settled_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_clawback_pending created');

        // 5. ai_config rows
        const configRows = [
            ['painter_attendance_enabled', '1', 'Master switch for painter attendance module'],
            ['painter_attendance_points_per_day', '100', 'AP credited per successful check-in'],
            ['painter_attendance_claim_rupees_per_pct', '1000', 'Customer billing ₹ required for 1% claim'],
            ['painter_attendance_claim_max_pct', '100', 'Maximum claim percentage'],
            ['painter_attendance_geofence_meters', '300', 'Max distance from branch center'],
            ['painter_attendance_claim_window_days', '7', 'Days after month-end claim stays open'],
            ['painter_attendance_image_retention_days', '8', 'Days after claim window before purge']
        ];
        for (const [k, v, d] of configRows) {
            await pool.query(
                'INSERT IGNORE INTO ai_config (config_key, config_value, description) VALUES (?, ?, ?)',
                [k, v, d]
            );
        }
        console.log(`✓ ${configRows.length} ai_config rows inserted`);

        // 6. Log branches missing GPS
        const [missing] = await pool.query(
            "SELECT id, name FROM branches WHERE status='active' AND (latitude IS NULL OR longitude IS NULL)"
        );
        if (missing.length > 0) {
            console.log(`\n⚠ ${missing.length} active branches missing GPS coordinates:`);
            missing.forEach(b => console.log(`   [${b.id}] ${b.name}`));
            console.log('   Set via admin branch-edit UI before enabling attendance.');
        } else {
            console.log('✓ All active branches have GPS coordinates');
        }

        console.log('\n✅ Migration completed successfully.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
```

- [ ] **Step 2: Create uploads folder**

Run: `mkdir -p public/uploads/painter-attendance`
Expected: directory exists, no error.

- [ ] **Step 3: Run migration**

Run: `node migrations/migrate-painter-attendance.js`
Expected: Four "✓ ... created" lines, "✓ 7 ai_config rows inserted", branch GPS status, "✅ Migration completed successfully."

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-painter-attendance.js
git commit -m "feat(attendance): add painter attendance DB schema + config"
```

---

## Task 2: Haversine Utility + Unit Tests

**Files:**
- Create: `services/painter-attendance-service.js` (partial — just haversine export)
- Create: `tests/unit/painter-attendance.test.js`

- [ ] **Step 1: Write failing test for haversine**

Create `tests/unit/painter-attendance.test.js`:
```javascript
const { haversineMeters } = require('../../services/painter-attendance-service');

describe('haversineMeters', () => {
    test('returns 0 for identical points', () => {
        expect(haversineMeters(13.0827, 80.2707, 13.0827, 80.2707)).toBe(0);
    });

    test('computes ~300m correctly (Chennai landmark test)', () => {
        // Marina Beach to Vivekanandar Illam ~900m
        const d = haversineMeters(13.0504, 80.2826, 13.0579, 80.2830);
        expect(d).toBeGreaterThan(800);
        expect(d).toBeLessThan(1000);
    });

    test('computes ~1km correctly', () => {
        // Two points ~1km apart
        const d = haversineMeters(13.0827, 80.2707, 13.0917, 80.2707);
        expect(d).toBeGreaterThan(900);
        expect(d).toBeLessThan(1100);
    });

    test('rounds to integer meters', () => {
        const d = haversineMeters(13.0827, 80.2707, 13.0827001, 80.2707001);
        expect(Number.isInteger(d)).toBe(true);
    });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: FAIL with "Cannot find module '../../services/painter-attendance-service'"

- [ ] **Step 3: Implement haversine in service**

Create `services/painter-attendance-service.js`:
```javascript
'use strict';

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
    return deg * Math.PI / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(EARTH_RADIUS_M * c);
}

module.exports = { haversineMeters };
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/painter-attendance-service.js tests/unit/painter-attendance.test.js
git commit -m "feat(attendance): haversine distance utility + unit tests"
```

---

## Task 3: Claim Formula + Unit Tests

**Files:**
- Modify: `services/painter-attendance-service.js` — add `computeClaimPct`, `computeClaimableAp`
- Modify: `tests/unit/painter-attendance.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/painter-attendance.test.js`:
```javascript
const { computeClaimPct, computeClaimableAp } = require('../../services/painter-attendance-service');

describe('computeClaimPct', () => {
    const cfg = { rupeesPerPct: 1000, maxPct: 100 };

    test('zero billed → 0%', () => expect(computeClaimPct(0, cfg)).toBe(0));
    test('₹999 → 0%', () => expect(computeClaimPct(999, cfg)).toBe(0));
    test('₹1,000 → 1%', () => expect(computeClaimPct(1000, cfg)).toBe(1));
    test('₹49,999 → 49%', () => expect(computeClaimPct(49999, cfg)).toBe(49));
    test('₹50,000 → 50%', () => expect(computeClaimPct(50000, cfg)).toBe(50));
    test('₹99,999 → 99%', () => expect(computeClaimPct(99999, cfg)).toBe(99));
    test('₹1,00,000 → 100%', () => expect(computeClaimPct(100000, cfg)).toBe(100));
    test('₹5,00,000 caps at 100%', () => expect(computeClaimPct(500000, cfg)).toBe(100));
});

describe('computeClaimableAp', () => {
    test('2000 AP × 50% → 1000', () => expect(computeClaimableAp(2000, 50)).toBe(1000));
    test('1500 AP × 33% → 495 (floor)', () => expect(computeClaimableAp(1500, 33)).toBe(495));
    test('100 AP × 0% → 0', () => expect(computeClaimableAp(100, 0)).toBe(0));
    test('0 AP × 100% → 0', () => expect(computeClaimableAp(0, 100)).toBe(0));
    test('2000 AP × 100% → 2000', () => expect(computeClaimableAp(2000, 100)).toBe(2000));
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: FAIL with "computeClaimPct is not a function"

- [ ] **Step 3: Implement formulas**

Append to `services/painter-attendance-service.js` (before `module.exports`):
```javascript
function computeClaimPct(rupeesBilled, cfg) {
    if (!rupeesBilled || rupeesBilled <= 0) return 0;
    const raw = Math.floor(rupeesBilled / cfg.rupeesPerPct);
    return Math.min(cfg.maxPct, raw);
}

function computeClaimableAp(totalAp, claimPct) {
    if (!totalAp || !claimPct) return 0;
    return Math.floor(totalAp * claimPct / 100);
}
```

Update export line:
```javascript
module.exports = { haversineMeters, computeClaimPct, computeClaimableAp };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: all 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/painter-attendance-service.js tests/unit/painter-attendance.test.js
git commit -m "feat(attendance): claim percentage + claimable AP formulas"
```

---

## Task 4: Config Loader + Service Setup

**Files:**
- Modify: `services/painter-attendance-service.js`

- [ ] **Step 1: Add pool setter + config loader**

Append to `services/painter-attendance-service.js` (at top after `EARTH_RADIUS_M`):
```javascript
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
```

Update export:
```javascript
module.exports = { setPool, loadConfig, haversineMeters, computeClaimPct, computeClaimableAp };
```

- [ ] **Step 2: Commit**

```bash
git add services/painter-attendance-service.js
git commit -m "feat(attendance): service pool setter + config loader"
```

---

## Task 5: Nearby-Branches Service Function + Test

**Files:**
- Modify: `services/painter-attendance-service.js`
- Modify: `tests/unit/painter-attendance.test.js`

- [ ] **Step 1: Add test**

Append to `tests/unit/painter-attendance.test.js`:
```javascript
const service = require('../../services/painter-attendance-service');

describe('findNearbyBranches', () => {
    let mockPool;
    beforeEach(() => {
        mockPool = {
            query: jest.fn().mockResolvedValue([[
                { id: 1, name: 'Chennai Main', latitude: 13.0827, longitude: 80.2707 },
                { id: 2, name: 'T. Nagar', latitude: 13.0418, longitude: 80.2341 }
            ]])
        };
        service.setPool(mockPool);
    });

    test('returns branches within 1km sorted by distance', async () => {
        const results = await service.findNearbyBranches(13.0830, 80.2710, 1000);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].branch_id).toBe(1);
        expect(results[0].distance_meters).toBeLessThan(100);
    });

    test('excludes branches beyond max distance', async () => {
        const results = await service.findNearbyBranches(13.0830, 80.2710, 500);
        expect(results.every(r => r.distance_meters <= 500)).toBe(true);
    });

    test('excludes branches with null GPS', async () => {
        mockPool.query.mockResolvedValue([[
            { id: 1, name: 'Has GPS', latitude: 13.0827, longitude: 80.2707 },
            { id: 2, name: 'No GPS', latitude: null, longitude: null }
        ]]);
        const results = await service.findNearbyBranches(13.0830, 80.2710, 5000);
        expect(results.map(r => r.branch_id)).toEqual([1]);
    });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: FAIL with "findNearbyBranches is not a function"

- [ ] **Step 3: Implement**

Append to `services/painter-attendance-service.js`:
```javascript
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
```

Update export line to include `findNearbyBranches`.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/painter-attendance-service.js tests/unit/painter-attendance.test.js
git commit -m "feat(attendance): findNearbyBranches with distance sorting"
```

---

## Task 6: Record Check-in + Monthly Recompute

**Files:**
- Modify: `services/painter-attendance-service.js`

- [ ] **Step 1: Implement `recordCheckin` + `recomputeMonthly`**

Append to `services/painter-attendance-service.js`:
```javascript
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
```

Update export to include `recordCheckin` and `recomputeMonthly`.

- [ ] **Step 2: Commit (no test here — covered by integration test in Task 21)**

```bash
git add services/painter-attendance-service.js
git commit -m "feat(attendance): recordCheckin + recomputeMonthly transactional helpers"
```

---

## Task 7: Multer Upload Config Verification

**Files:**
- Verify: `config/uploads.js`

- [ ] **Step 1: Open file and confirm `uploadPainterAttendance` exists**

Expected: `uploadPainterAttendance` is already defined around lines 127-131 using `createDiskStorage('public/uploads/painter-attendance/', 'checkin')`. Confirm it is also exported in `module.exports`. If not exported, add it.

If not exported:
```javascript
// At end of file, update exports
module.exports = {
    ...,
    uploadPainterAttendance
};
```

- [ ] **Step 2: Commit if changed, skip otherwise**

```bash
git add config/uploads.js
git commit -m "feat(attendance): export uploadPainterAttendance from config"
```

---

## Task 8: Painter Check-in Endpoint

**Files:**
- Modify: `routes/painters.js`

- [ ] **Step 1: Locate where painter endpoints are defined**

Search `routes/painters.js` for another `/me/...` endpoint (e.g., `/me/estimates`) to find the conventional position for new endpoints. Add new endpoints near similar `/me/*` routes.

- [ ] **Step 2: Add require at top of file**

Near the existing requires, add:
```javascript
const attendanceService = require('../services/painter-attendance-service');
const { uploadPainterAttendance } = require('../config/uploads');
```

Inside `setPool` function, also call `attendanceService.setPool(p);`

- [ ] **Step 3: Add `GET /me/attendance/branches-nearby`**

```javascript
router.get('/me/attendance/branches-nearby', requirePainterAuth, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        if (!isFinite(lat) || !isFinite(lng)) {
            return res.status(400).json({ error: 'lat and lng required' });
        }
        const branches = await attendanceService.findNearbyBranches(lat, lng, 1000);
        res.json({ branches });
    } catch (err) {
        console.error('nearby branches error:', err);
        res.status(500).json({ error: 'Failed to load branches' });
    }
});
```

- [ ] **Step 4: Add `POST /me/attendance/checkin`**

```javascript
router.post('/me/attendance/checkin', requirePainterAuth, uploadPainterAttendance.single('selfie'), async (req, res) => {
    const painterId = req.painter.id;
    const branchId = parseInt(req.body.branch_id, 10);
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);

    try {
        if (!req.file) return res.status(400).json({ code: 'SELFIE_REQUIRED', error: 'Selfie image required' });
        if (!isFinite(lat) || !isFinite(lng) || !branchId) {
            return res.status(400).json({ error: 'branch_id, latitude, longitude required' });
        }

        const cfg = await attendanceService.loadConfig();
        if (!cfg.enabled) return res.status(503).json({ error: 'Attendance temporarily disabled' });

        // Load branch
        const [branchRows] = await pool.query(
            "SELECT id, name, latitude, longitude FROM branches WHERE id=? AND status='active'",
            [branchId]
        );
        if (branchRows.length === 0) return res.status(400).json({ code: 'BRANCH_INACTIVE', error: 'Branch not found or inactive' });
        const branch = branchRows[0];
        if (branch.latitude == null || branch.longitude == null) {
            return res.status(400).json({ code: 'BRANCH_NO_GPS', error: 'Branch has no GPS set' });
        }

        // Geofence check
        const distance = attendanceService.haversineMeters(lat, lng, Number(branch.latitude), Number(branch.longitude));
        if (distance > cfg.geofenceMeters) {
            const nearby = await attendanceService.findNearbyBranches(lat, lng, 5000);
            const closest = nearby[0] || null;
            return res.status(400).json({
                code: 'OUTSIDE_GEOFENCE',
                distance_meters: distance,
                max_meters: cfg.geofenceMeters,
                closest_branch: closest ? { id: closest.branch_id, name: closest.name, distance_meters: closest.distance_meters } : null,
                error: `You are ${distance}m from ${branch.name}. Must be within ${cfg.geofenceMeters}m.`
            });
        }

        // Duplicate check
        const pad = n => String(n).padStart(2, '0');
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const [dup] = await pool.query(
            "SELECT id, checkin_at, branch_id FROM painter_attendance_checkins WHERE painter_id=? AND checkin_date=?",
            [painterId, dateStr]
        );
        if (dup.length > 0) {
            return res.status(409).json({
                code: 'ALREADY_CHECKED_IN',
                existing_checkin: dup[0],
                error: 'Already checked in today'
            });
        }

        // Record
        const selfiePath = req.file.path.replace(/\\/g, '/').replace(/^public\//, '/');
        const result = await attendanceService.recordCheckin({
            painterId,
            branchId,
            lat,
            lng,
            selfiePath,
            distanceMeters: distance,
            pointsPerDay: cfg.pointsPerDay
        });

        // Notify
        try {
            const painterNotif = require('../services/painter-notification-service');
            await painterNotif.sendToPainter(painterId, {
                type: 'attendance_checkin_confirmed',
                title: `✓ Check-in confirmed at ${branch.name}`,
                title_ta: `✓ ${branch.name}-ல் சரிபார்ப்பு வெற்றி`,
                body: `${cfg.pointsPerDay} AP earned for today.`,
                body_ta: `இன்று ${cfg.pointsPerDay} AP சேர்க்கப்பட்டது.`,
                data: { screen: 'attendance', checkin_id: String(result.checkinId) }
            });
        } catch (e) { console.warn('notif failed:', e.message); }

        // Existing streak hook (optional; keeps streak parallel)
        try {
            const [streak] = await pool.query(
                `INSERT INTO painter_daily_checkins (painter_id, checkin_date)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE checkin_date = VALUES(checkin_date)`,
                [painterId, dateStr]
            );
        } catch (e) { /* existing streak logic may differ — ignore */ }

        res.json({
            checkin_id: result.checkinId,
            ap_earned: cfg.pointsPerDay,
            month_key: result.monthKey
        });
    } catch (err) {
        console.error('checkin error:', err);
        res.status(500).json({ error: 'Check-in failed', detail: err.message });
    }
});
```

- [ ] **Step 5: Manual smoke test**

Start server: `node server.js`
Curl:
```bash
curl -H "X-Painter-Token: <valid-token>" "http://localhost:3000/api/me/attendance/branches-nearby?lat=13.0827&lng=80.2707"
```
Expected: JSON `{branches: [...]}`.

- [ ] **Step 6: Commit**

```bash
git add routes/painters.js
git commit -m "feat(attendance): painter checkin + nearby-branches endpoints"
```

---

## Task 9: Painter Month-Summary + History Endpoints

**Files:**
- Modify: `routes/painters.js`

- [ ] **Step 1: Add `GET /me/attendance/month`**

```javascript
router.get('/me/attendance/month', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;
        const monthKey = req.query.month || (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();

        const cfg = await attendanceService.loadConfig();

        const [checkins] = await pool.query(
            `SELECT id, branch_id, checkin_date, checkin_at, distance_meters, selfie_path, status, points_awarded
             FROM painter_attendance_checkins
             WHERE painter_id=? AND month_key=? ORDER BY checkin_date`,
            [painterId, monthKey]
        );
        const [monthlyRows] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [painterId, monthKey]
        );
        const monthly = monthlyRows[0] || null;

        // Live preview of claim for current month
        const [billingRows] = await pool.query(
            `SELECT COALESCE(SUM(total),0) AS billed
             FROM painter_estimates
             WHERE painter_id=? AND billing_type='customer'
               AND status IN ('pushed_to_zoho','payment_recorded')
               AND DATE_FORMAT(created_at, '%Y-%m')=?`,
            [painterId, monthKey]
        );
        const billed = Number(billingRows[0].billed);
        const claimPctPreview = attendanceService.computeClaimPct(billed, cfg);
        const totalAp = monthly ? monthly.total_ap_earned : checkins.filter(c => c.status === 'approved').length * cfg.pointsPerDay;
        const claimablePreview = attendanceService.computeClaimableAp(totalAp, claimPctPreview);

        res.json({
            month_key: monthKey,
            checkins,
            total_checkins: checkins.filter(c => c.status === 'approved').length,
            total_ap_earned: totalAp,
            monthly_customer_billed_preview: billed,
            claim_pct_preview: claimPctPreview,
            claimable_ap_preview: claimablePreview,
            claim_status: monthly ? monthly.claim_status : 'pending',
            ap_claimed: monthly ? monthly.ap_claimed : 0,
            claim_window: monthly && monthly.claim_window_opens_at ? {
                opens_at: monthly.claim_window_opens_at,
                closes_at: monthly.claim_window_closes_at
            } : null
        });
    } catch (err) {
        console.error('month summary error:', err);
        res.status(500).json({ error: 'Failed to load month summary' });
    }
});
```

- [ ] **Step 2: Add `GET /me/attendance/history`**

```javascript
router.get('/me/attendance/history', requirePainterAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT month_key, total_checkins, total_ap_earned, monthly_customer_billed,
                    claim_pct, claimable_ap, ap_claimed, claim_status, claimed_at, forfeited_at
             FROM painter_attendance_monthly
             WHERE painter_id=?
             ORDER BY month_key DESC
             LIMIT 12`,
            [req.painter.id]
        );
        res.json({ history: rows });
    } catch (err) {
        console.error('history error:', err);
        res.status(500).json({ error: 'Failed to load history' });
    }
});
```

- [ ] **Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat(attendance): painter month + history endpoints"
```

---

## Task 10: Claim Endpoint + Service Function

**Files:**
- Modify: `services/painter-attendance-service.js`
- Modify: `routes/painters.js`

- [ ] **Step 1: Add `claimMonth` to service**

Append to `services/painter-attendance-service.js`:
```javascript
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

        // Credit regular pool (outside txn — points-engine has its own)
        await pointsEngine.addPoints(
            painterId,
            'regular',
            m.claimable_ap,
            'attendance_claim',
            m.id,
            'attendance_monthly',
            `Attendance claim ${monthKey}`,
            null
        );

        return { claimed_ap: m.claimable_ap, month_key: monthKey };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}
```

Update export to include `claimMonth`.

- [ ] **Step 2: Add `POST /me/attendance/claim`**

In `routes/painters.js`:
```javascript
router.post('/me/attendance/claim', requirePainterAuth, async (req, res) => {
    try {
        const monthKey = req.body.month_key;
        if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
            return res.status(400).json({ error: 'month_key required (YYYY-MM)' });
        }
        const result = await attendanceService.claimMonth(req.painter.id, monthKey);

        try {
            const painterNotif = require('../services/painter-notification-service');
            await painterNotif.sendToPainter(req.painter.id, {
                type: 'attendance_claimed_success',
                title: `✓ Claimed ${result.claimed_ap} AP`,
                title_ta: `✓ ${result.claimed_ap} AP கிளைம் ஆகிவிட்டது`,
                body: `${result.claimed_ap} AP added to your Regular points.`,
                body_ta: `${result.claimed_ap} AP உங்கள் Regular புள்ளிகளில் சேர்க்கப்பட்டது.`,
                data: { screen: 'points' }
            });
        } catch (e) {}

        res.json(result);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
        console.error('claim error:', err);
        res.status(500).json({ error: 'Claim failed' });
    }
});
```

- [ ] **Step 3: Commit**

```bash
git add services/painter-attendance-service.js routes/painters.js
git commit -m "feat(attendance): claimMonth service + POST /me/attendance/claim"
```

---

## Task 11: Points Engine Clawback-Pending Integration

**Files:**
- Modify: `services/painter-points-engine.js`

- [ ] **Step 1: Read `addPoints` function (lines 41-77) and add clawback netting at credit time**

At the start of `addPoints`, **before** crediting:
```javascript
async function addPoints(painterId, pointPool, amount, source, refId, refType, description, createdBy) {
    // Net out pending clawbacks first (regular pool only)
    if (pointPool === 'regular' && amount > 0) {
        const [pending] = await pool.query(
            'SELECT id, amount FROM painter_clawback_pending WHERE painter_id=? AND settled_at IS NULL ORDER BY created_at',
            [painterId]
        );
        let remaining = amount;
        for (const row of pending) {
            if (remaining <= 0) break;
            const deduct = Math.min(remaining, row.amount);
            if (deduct === row.amount) {
                await pool.query('UPDATE painter_clawback_pending SET settled_at=NOW() WHERE id=?', [row.id]);
            } else {
                await pool.query('UPDATE painter_clawback_pending SET amount = amount - ? WHERE id=?', [deduct, row.id]);
            }
            remaining -= deduct;
        }
        if (remaining <= 0) {
            return 0; // entire credit absorbed by clawbacks
        }
        amount = remaining; // proceed with reduced credit
    }
    // ... existing logic below (unchanged)
}
```

**Note:** The existing function body continues unchanged — this block is inserted at the top. Review the final function to ensure `amount` is consistently used downstream.

- [ ] **Step 2: Add helper to insert pending clawback**

Append at bottom of file before `module.exports`:
```javascript
async function queueClawback(painterId, amount, reason, source = 'attendance') {
    await pool.query(
        'INSERT INTO painter_clawback_pending (painter_id, amount, reason, source) VALUES (?, ?, ?, ?)',
        [painterId, amount, reason, source]
    );
}
```

Add `queueClawback` to exports.

- [ ] **Step 3: Commit**

```bash
git add services/painter-points-engine.js
git commit -m "feat(attendance): points engine nets pending clawbacks on credit"
```

---

## Task 12: Admin Reject Endpoint

**Files:**
- Modify: `services/painter-attendance-service.js`
- Modify: `routes/painters.js`

- [ ] **Step 1: Add `rejectCheckin` to service**

```javascript
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

        // Handle already-claimed case
        const [monthlyRows] = await conn.query(
            'SELECT claim_status, ap_claimed FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [c.painter_id, c.month_key]
        );
        const mStatus = monthlyRows[0] && monthlyRows[0].claim_status;

        await conn.commit();

        if (mStatus === 'claimed') {
            // Try immediate debit from regular pool; else queue clawback
            const [bal] = await pool.query(
                "SELECT COALESCE(SUM(CASE WHEN type='earn' THEN amount ELSE -amount END),0) AS balance FROM painter_point_ledger WHERE painter_id=? AND pool='regular'",
                [c.painter_id]
            );
            const currentBal = Number(bal[0].balance);
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
```

Update export to include `rejectCheckin`.

**Note:** The query `FROM painter_point_ledger` assumes the existing points ledger table name. Verify with `grep -n "painter_point_ledger\|painter_points_ledger" services/painter-points-engine.js` and adjust table name if needed.

- [ ] **Step 2: Add admin endpoint**

In `routes/painters.js`:
```javascript
router.post('/attendance/:checkinId/reject', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const checkinId = parseInt(req.params.checkinId, 10);
        const { reason } = req.body;
        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ error: 'reason (3+ chars) required' });
        }
        const result = await attendanceService.rejectCheckin(checkinId, reason.trim(), req.user.id);

        try {
            const painterNotif = require('../services/painter-notification-service');
            await painterNotif.sendToPainter(result.painter_id, {
                type: 'attendance_rejected',
                title: '⚠ Check-in rejected',
                title_ta: '⚠ சரிபார்ப்பு நிராகரிக்கப்பட்டது',
                body: `${result.clawback} AP removed. Reason: ${reason}`,
                body_ta: `${result.clawback} AP நீக்கப்பட்டது. காரணம்: ${reason}`,
                data: { screen: 'attendance' }
            });
        } catch (e) {}

        res.json(result);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
        console.error('reject error:', err);
        res.status(500).json({ error: 'Reject failed' });
    }
});
```

- [ ] **Step 3: Commit**

```bash
git add services/painter-attendance-service.js routes/painters.js
git commit -m "feat(attendance): admin reject endpoint with clawback handling"
```

---

## Task 13: Admin Today + Monthly + Calendar Endpoints

**Files:**
- Modify: `routes/painters.js`

- [ ] **Step 1: Add `GET /attendance/today`**

```javascript
router.get('/attendance/today', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { branch_id, date } = req.query;
        const dateStr = date || new Date().toISOString().slice(0, 10);
        const params = [dateStr];
        let where = 'c.checkin_date = ?';
        if (branch_id) { where += ' AND c.branch_id = ?'; params.push(branch_id); }

        const [rows] = await pool.query(
            `SELECT c.id, c.painter_id, p.full_name AS painter_name, p.profile_photo,
                    c.branch_id, b.name AS branch_name,
                    c.checkin_at, c.distance_meters, c.selfie_path,
                    c.status, c.rejected_reason, c.points_awarded
             FROM painter_attendance_checkins c
             JOIN painters p ON p.id = c.painter_id
             JOIN branches b ON b.id = c.branch_id
             WHERE ${where}
             ORDER BY c.checkin_at DESC`,
            params
        );
        res.json({ date: dateStr, checkins: rows });
    } catch (err) {
        console.error('today error:', err);
        res.status(500).json({ error: 'Failed to load today' });
    }
});
```

- [ ] **Step 2: Add `GET /attendance/monthly`**

```javascript
router.get('/attendance/monthly', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const monthKey = req.query.month || (() => {
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const branchId = req.query.branch_id;
        const params = [monthKey];
        let branchFilter = '';
        if (branchId) {
            branchFilter = `AND p.id IN (SELECT DISTINCT painter_id FROM painter_attendance_checkins WHERE branch_id=? AND month_key=?)`;
            params.push(branchId, monthKey);
        }
        const [rows] = await pool.query(
            `SELECT m.*, p.full_name, p.profile_photo
             FROM painter_attendance_monthly m
             JOIN painters p ON p.id = m.painter_id
             WHERE m.month_key=? ${branchFilter}
             ORDER BY m.total_ap_earned DESC`,
            params
        );
        res.json({ month_key: monthKey, rows });
    } catch (err) {
        console.error('monthly error:', err);
        res.status(500).json({ error: 'Failed to load monthly' });
    }
});
```

- [ ] **Step 3: Add `GET /:painterId/attendance/calendar`**

```javascript
router.get('/:painterId/attendance/calendar', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.painterId, 10);
        const monthKey = req.query.month || (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const [checkins] = await pool.query(
            `SELECT c.*, b.name AS branch_name, u.full_name AS rejected_by_name
             FROM painter_attendance_checkins c
             JOIN branches b ON b.id = c.branch_id
             LEFT JOIN users u ON u.id = c.rejected_by
             WHERE c.painter_id=? AND c.month_key=?
             ORDER BY c.checkin_date`,
            [painterId, monthKey]
        );
        const [monthlyRows] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [painterId, monthKey]
        );
        res.json({ month_key: monthKey, checkins, monthly: monthlyRows[0] || null });
    } catch (err) {
        console.error('calendar error:', err);
        res.status(500).json({ error: 'Failed to load calendar' });
    }
});
```

**Important:** Place these routes BEFORE any `/:id` catch-all painter routes per route-ordering rule.

- [ ] **Step 4: Commit**

```bash
git add routes/painters.js
git commit -m "feat(attendance): admin today/monthly/calendar endpoints"
```

---

## Task 14: Cron Job — Open Monthly Claim

**Files:**
- Modify: `services/painter-attendance-service.js`
- Modify: `services/painter-scheduler.js`

- [ ] **Step 1: Add `openMonthlyClaim` to service**

```javascript
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
```

Export both functions.

- [ ] **Step 2: Register crons in `services/painter-scheduler.js`**

Find the existing `jobs.monthlySlabs = cron.schedule(...)` block (around line 238). Add after it:
```javascript
const attendanceService = require('./painter-attendance-service');

function prevMonthKey() {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function runOpenAttendanceClaim() {
    try {
        console.log('[attendance] opening monthly claim window...');
        const { opened } = await attendanceService.openMonthlyClaim(prevMonthKey());
        console.log(`[attendance] opened claim for ${opened} painter(s)`);
    } catch (err) {
        console.error('[attendance] open claim failed:', err);
    }
}

async function runRecomputeClaimable() {
    try {
        await attendanceService.recomputeClaimable(prevMonthKey());
    } catch (err) {
        console.error('[attendance] recompute failed:', err);
    }
}

jobs.attendanceOpenClaim = cron.schedule('5 0 1 * *', runOpenAttendanceClaim, { timezone: 'Asia/Kolkata' });
jobs.attendanceRecompute = cron.schedule('0 */6 1-7 * *', runRecomputeClaimable, { timezone: 'Asia/Kolkata' });
```

- [ ] **Step 3: Commit**

```bash
git add services/painter-attendance-service.js services/painter-scheduler.js
git commit -m "feat(attendance): openMonthlyClaim + recomputeClaimable crons"
```

---

## Task 15: Cron Jobs — Reminder + Forfeit + Purge

**Files:**
- Modify: `services/painter-attendance-service.js`
- Modify: `services/painter-scheduler.js`

- [ ] **Step 1: Add `remindUnclaimed` + `forfeitAndPurge` to service**

```javascript
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

const fs = require('fs').promises;
const path = require('path');

async function forfeitAndPurge(monthKey) {
    // Forfeit
    const [unclaimed] = await pool.query(
        "SELECT id, painter_id FROM painter_attendance_monthly WHERE month_key=? AND claim_status='available'",
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
            [m.painter_id, monthKey]
        );
    }

    // Purge images from month folder(s)
    const uploadsRoot = path.join(__dirname, '..', 'public', 'uploads', 'painter-attendance');
    try {
        const painterDirs = await fs.readdir(uploadsRoot);
        let purged = 0;
        for (const pd of painterDirs) {
            const painterPath = path.join(uploadsRoot, pd);
            const stat = await fs.stat(painterPath).catch(() => null);
            if (!stat || !stat.isDirectory()) continue;
            const files = await fs.readdir(painterPath);
            for (const f of files) {
                if (f.startsWith(monthKey)) {
                    await fs.unlink(path.join(painterPath, f)).catch(() => {});
                    purged++;
                }
            }
        }
        return { forfeited: unclaimed.length, purged };
    } catch (err) {
        console.error('[attendance] purge failed:', err);
        return { forfeited: unclaimed.length, purged: 0 };
    }
}
```

Export both.

- [ ] **Step 2: Register crons**

In `services/painter-scheduler.js`, append:
```javascript
async function runRemindUnclaimed() {
    try {
        const { reminded } = await attendanceService.remindUnclaimed(prevMonthKey());
        console.log(`[attendance] reminded ${reminded} painter(s)`);
    } catch (err) { console.error('[attendance] remind failed:', err); }
}

async function runForfeitAndPurge() {
    try {
        // Purge month key = 2 months ago (so April's images purged on June 8)
        const d = new Date();
        d.setMonth(d.getMonth() - 2);
        const purgeKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const { forfeited, purged } = await attendanceService.forfeitAndPurge(prevMonthKey());
        console.log(`[attendance] forfeited=${forfeited} purged=${purged}`);
    } catch (err) { console.error('[attendance] forfeit failed:', err); }
}

jobs.attendanceRemind = cron.schedule('0 20 7 * *', runRemindUnclaimed, { timezone: 'Asia/Kolkata' });
jobs.attendanceForfeit = cron.schedule('0 2 8 * *', runForfeitAndPurge, { timezone: 'Asia/Kolkata' });
```

- [ ] **Step 3: Commit**

```bash
git add services/painter-attendance-service.js services/painter-scheduler.js
git commit -m "feat(attendance): reminder + forfeit-and-purge crons"
```

---

## Task 16: Integration Test — Full Check-in → Claim Flow

**Files:**
- Create: `tests/integration/painter-attendance-flow.test.js`

- [ ] **Step 1: Write integration test**

```javascript
const mysql = require('mysql2/promise');
const attendanceService = require('../../services/painter-attendance-service');

let pool;
let testPainterId;
let testBranchId;

beforeAll(async () => {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME_TEST || process.env.DB_NAME || 'business_manager',
        port: process.env.DB_PORT || 3306
    });
    attendanceService.setPool(pool);

    // Create test painter
    const [p] = await pool.query(
        "INSERT INTO painters (full_name, phone, city, specialization) VALUES ('Test Painter', '9999999999', 'Chennai', 'painter')"
    );
    testPainterId = p.insertId;

    // Create/reuse test branch
    const [b] = await pool.query(
        "SELECT id FROM branches WHERE status='active' AND latitude IS NOT NULL LIMIT 1"
    );
    if (b.length > 0) {
        testBranchId = b[0].id;
    } else {
        const [br] = await pool.query(
            "INSERT INTO branches (name, status, latitude, longitude) VALUES ('Test Branch', 'active', 13.0827, 80.2707)"
        );
        testBranchId = br.insertId;
    }
});

afterAll(async () => {
    await pool.query('DELETE FROM painter_attendance_ledger WHERE painter_id=?', [testPainterId]);
    await pool.query('DELETE FROM painter_attendance_checkins WHERE painter_id=?', [testPainterId]);
    await pool.query('DELETE FROM painter_attendance_monthly WHERE painter_id=?', [testPainterId]);
    await pool.query('DELETE FROM painter_clawback_pending WHERE painter_id=?', [testPainterId]);
    await pool.query('DELETE FROM painters WHERE id=?', [testPainterId]);
    await pool.end();
});

describe('attendance flow', () => {
    test('check-in creates ledger + monthly row', async () => {
        const result = await attendanceService.recordCheckin({
            painterId: testPainterId,
            branchId: testBranchId,
            lat: 13.0827,
            lng: 80.2707,
            selfiePath: '/uploads/painter-attendance/test.jpg',
            distanceMeters: 10,
            pointsPerDay: 100
        });
        expect(result.checkinId).toBeGreaterThan(0);
        const [ledger] = await pool.query(
            "SELECT * FROM painter_attendance_ledger WHERE painter_id=? AND type='earn'",
            [testPainterId]
        );
        expect(ledger.length).toBe(1);
        expect(ledger[0].ap_delta).toBe(100);

        const [monthly] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=?',
            [testPainterId]
        );
        expect(monthly[0].total_checkins).toBe(1);
        expect(monthly[0].total_ap_earned).toBe(100);
    });

    test('duplicate check-in same day errors via UNIQUE key', async () => {
        await expect(attendanceService.recordCheckin({
            painterId: testPainterId,
            branchId: testBranchId,
            lat: 13.0827,
            lng: 80.2707,
            selfiePath: '/test2.jpg',
            distanceMeters: 10,
            pointsPerDay: 100
        })).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/integration/painter-attendance-flow.test.js --runInBand`
Expected: 2 tests PASS. If DB is not set up, consider using a dedicated test DB env.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/painter-attendance-flow.test.js
git commit -m "test(attendance): integration tests for check-in flow"
```

---

## Task 17: Notification Service — Register Types

**Files:**
- Modify: `services/painter-notification-service.js`

- [ ] **Step 1: Verify type registration pattern**

Read the existing notification service around lines 240-260 to understand how payloads are declared. Then add a `buildAttendancePayload()` helper **only if** the service requires explicit type registration. If it accepts arbitrary `{type, title, ...}` (confirmed in Task 8/10 inline calls), **skip this step** — no changes needed.

- [ ] **Step 2: If registration needed, add payloads**

If the service has a payload registry object, add six entries matching the types already used inline: `attendance_checkin_confirmed`, `attendance_claim_window_open`, `attendance_claim_reminder`, `attendance_claimed_success`, `attendance_rejected`, `attendance_forfeited`.

- [ ] **Step 3: Commit (skip if no changes)**

```bash
git add services/painter-notification-service.js 2>/dev/null
git commit -m "feat(attendance): register notification types" 2>/dev/null || echo "No changes needed"
```

---

## Task 18: Admin Web — Attendance Tab (HTML + wiring)

**Files:**
- Modify: `public/admin-painters.html`

- [ ] **Step 1: Add tab button**

Find the tab button row (around line 93-99) and add a new button at the end:
```html
<button class="tab-btn" onclick="switchTab('attendance')">Attendance</button>
```

- [ ] **Step 2: Add tab content pane**

After the last `<div id="tab-...">` pane, add:
```html
<div id="tab-attendance" class="tab-content hidden">
    <div class="flex flex-wrap gap-2 mb-4">
        <button class="tab-btn-sub active" onclick="switchAttTab('today')">Today</button>
        <button class="tab-btn-sub" onclick="switchAttTab('monthly')">Monthly Summary</button>
    </div>

    <div id="att-sub-today" class="att-sub-content">
        <div class="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex gap-3 items-end">
            <div>
                <label class="text-xs text-gray-600">Date</label>
                <input type="date" id="att-today-date" class="border rounded px-3 py-2">
            </div>
            <div>
                <label class="text-xs text-gray-600">Branch</label>
                <select id="att-today-branch" class="border rounded px-3 py-2">
                    <option value="">All branches</option>
                </select>
            </div>
            <button onclick="loadAttendanceToday()" class="bg-indigo-600 text-white px-4 py-2 rounded">Load</button>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table class="data-table w-full">
                <thead>
                    <tr><th>Painter</th><th>Branch</th><th>Time</th><th>Distance</th><th>Selfie</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody id="att-today-tbody"></tbody>
            </table>
        </div>
    </div>

    <div id="att-sub-monthly" class="att-sub-content hidden">
        <div class="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex gap-3 items-end">
            <div>
                <label class="text-xs text-gray-600">Month</label>
                <input type="month" id="att-month-picker" class="border rounded px-3 py-2">
            </div>
            <button onclick="loadAttendanceMonthly()" class="bg-indigo-600 text-white px-4 py-2 rounded">Load</button>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table class="data-table w-full">
                <thead>
                    <tr><th>Painter</th><th>Check-ins</th><th>AP Earned</th><th>Billed</th><th>Claim %</th><th>Claimable</th><th>Status</th></tr>
                </thead>
                <tbody id="att-monthly-tbody"></tbody>
            </table>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Add JS handlers**

Inside the existing `<script>` block, add:
```javascript
function switchAttTab(name) {
    document.querySelectorAll('.att-sub-content').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('.tab-btn-sub').forEach(b => b.classList.remove('active'));
    document.getElementById('att-sub-' + name).classList.remove('hidden');
    event.target.classList.add('active');
}

async function loadAttendanceToday() {
    const date = document.getElementById('att-today-date').value || new Date().toISOString().slice(0, 10);
    const branchId = document.getElementById('att-today-branch').value;
    const params = new URLSearchParams({ date });
    if (branchId) params.set('branch_id', branchId);
    const r = await fetch('/api/painters/attendance/today?' + params, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
    });
    const data = await r.json();
    const tbody = document.getElementById('att-today-tbody');
    tbody.innerHTML = (data.checkins || []).map(c => `
        <tr>
            <td>${escapeHtml(c.painter_name)}</td>
            <td>${escapeHtml(c.branch_name)}</td>
            <td>${new Date(c.checkin_at).toLocaleTimeString('en-IN')}</td>
            <td>${c.distance_meters}m</td>
            <td><a href="${c.selfie_path}" target="_blank"><img src="${c.selfie_path}" class="w-12 h-12 rounded object-cover"></a></td>
            <td>${c.status === 'rejected' ? '<span class="text-red-600">Rejected</span>' : '<span class="text-green-600">Approved</span>'}</td>
            <td>${c.status === 'approved' ? `<button onclick="rejectCheckin(${c.id})" class="text-red-600 text-sm">Reject</button>` : ''}</td>
        </tr>
    `).join('');
}

async function rejectCheckin(id) {
    const reason = prompt('Reject reason:');
    if (!reason || reason.trim().length < 3) return;
    const r = await fetch(`/api/painters/attendance/${id}/reject`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('auth_token')
        },
        body: JSON.stringify({ reason: reason.trim() })
    });
    if (r.ok) { alert('Rejected'); loadAttendanceToday(); }
    else { const e = await r.json(); alert('Failed: ' + e.error); }
}

async function loadAttendanceMonthly() {
    const month = document.getElementById('att-month-picker').value;
    if (!month) return alert('Pick a month');
    const r = await fetch(`/api/painters/attendance/monthly?month=${month}`, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
    });
    const data = await r.json();
    document.getElementById('att-monthly-tbody').innerHTML = (data.rows || []).map(m => `
        <tr>
            <td>${escapeHtml(m.full_name)}</td>
            <td>${m.total_checkins}</td>
            <td>${m.total_ap_earned}</td>
            <td>₹${Number(m.monthly_customer_billed).toLocaleString('en-IN')}</td>
            <td>${m.claim_pct}%</td>
            <td>${m.claimable_ap}</td>
            <td><span class="badge badge-${m.claim_status}">${m.claim_status}</span></td>
        </tr>
    `).join('');
}

// Populate branch filter on page load
(async function() {
    try {
        const r = await fetch('/api/branches', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const data = await r.json();
        const sel = document.getElementById('att-today-branch');
        (data.branches || data || []).forEach(b => {
            if (sel) sel.insertAdjacentHTML('beforeend', `<option value="${b.id}">${b.name}</option>`);
        });
        const d = new Date().toISOString().slice(0, 10);
        const dateInput = document.getElementById('att-today-date');
        if (dateInput) dateInput.value = d;
    } catch (e) {}
})();
```

- [ ] **Step 4: Manual smoke test**

1. Open `admin-painters.html` in browser, login as admin.
2. Click "Attendance" tab → Today sub-tab shows empty table (if no check-ins today).
3. Monthly sub-tab with a known month → shows painter rollups.

- [ ] **Step 5: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(attendance): admin Attendance tab (today + monthly)"
```

---

## Task 19: Painter Dashboard — AP Hero Row

**Files:**
- Modify: `public/painter-dashboard.html`

- [ ] **Step 1: Add AP row to hero**

Find the hero points card section in `painter-dashboard.html` (search for "Points" near the top card). Insert below the regular/annual pool cards:
```html
<div class="mt-3 p-3 rounded-lg bg-green-50 border border-green-200" id="attendance-hero">
    <div class="flex items-center justify-between">
        <div>
            <div class="text-xs text-green-800 font-medium">This Month Attendance</div>
            <div class="text-lg font-bold text-green-900" id="att-hero-summary">— check-ins · — AP</div>
            <div class="text-xs text-gray-600" id="att-hero-preview">Preview loading...</div>
        </div>
        <div class="flex gap-2">
            <a href="#" onclick="window.location='/painter-checkin.html'; return false;" class="bg-green-600 text-white px-3 py-2 rounded text-sm">Check-in</a>
            <button id="btn-claim-ap" onclick="claimAp()" class="hidden bg-yellow-500 text-white px-3 py-2 rounded text-sm">Claim</button>
        </div>
    </div>
</div>
<script>
(async function loadAttendanceHero() {
    try {
        const r = await fetch('/api/me/attendance/month', { headers: { 'X-Painter-Token': localStorage.getItem('painter_token') } });
        if (!r.ok) return;
        const d = await r.json();
        document.getElementById('att-hero-summary').textContent = `${d.total_checkins} check-ins · ${d.total_ap_earned} AP`;
        document.getElementById('att-hero-preview').textContent = `≈ ${d.claimable_ap_preview} claimable (₹${Number(d.monthly_customer_billed_preview).toLocaleString('en-IN')} bills, ${d.claim_pct_preview}%)`;
        if (d.claim_status === 'available' && d.claimable_ap_preview > 0) {
            document.getElementById('btn-claim-ap').classList.remove('hidden');
            document.getElementById('btn-claim-ap').textContent = `Claim ${d.claimable_ap_preview} AP`;
            document.getElementById('btn-claim-ap').dataset.month = d.month_key;
        }
    } catch (e) { console.warn('att hero failed', e); }
})();

async function claimAp() {
    const month = document.getElementById('btn-claim-ap').dataset.month;
    if (!confirm(`Claim AP for ${month}?`)) return;
    const r = await fetch('/api/me/attendance/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Painter-Token': localStorage.getItem('painter_token') },
        body: JSON.stringify({ month_key: month })
    });
    const d = await r.json();
    if (r.ok) { alert(`Claimed ${d.claimed_ap} AP`); location.reload(); }
    else alert('Failed: ' + (d.error || 'Unknown error'));
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat(attendance): painter dashboard AP hero row + claim button"
```

---

## Task 20: Android — Retrofit API Interface

**Files:**
- Create: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/network/AttendanceApi.kt`

- [ ] **Step 1: Create Retrofit interface**

```kotlin
package com.qcpaintshop.painter.network

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.*

data class NearbyBranch(
    val branch_id: Int,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val distance_meters: Int
)
data class NearbyBranchesResponse(val branches: List<NearbyBranch>)

data class CheckinResponse(
    val checkin_id: Int,
    val ap_earned: Int,
    val month_key: String
)

data class CheckinItem(
    val id: Int,
    val branch_id: Int,
    val checkin_date: String,
    val checkin_at: String,
    val distance_meters: Int,
    val selfie_path: String,
    val status: String,
    val points_awarded: Int
)

data class MonthSummary(
    val month_key: String,
    val checkins: List<CheckinItem>,
    val total_checkins: Int,
    val total_ap_earned: Int,
    val monthly_customer_billed_preview: Double,
    val claim_pct_preview: Int,
    val claimable_ap_preview: Int,
    val claim_status: String,
    val ap_claimed: Int,
    val claim_window: ClaimWindow?
)
data class ClaimWindow(val opens_at: String, val closes_at: String)

data class HistoryRow(
    val month_key: String,
    val total_checkins: Int,
    val total_ap_earned: Int,
    val monthly_customer_billed: Double,
    val claim_pct: Double,
    val claimable_ap: Int,
    val ap_claimed: Int,
    val claim_status: String,
    val claimed_at: String?,
    val forfeited_at: String?
)
data class HistoryResponse(val history: List<HistoryRow>)

data class ClaimRequest(val month_key: String)
data class ClaimResponse(val claimed_ap: Int, val month_key: String)

interface AttendanceApi {
    @GET("me/attendance/branches-nearby")
    suspend fun nearby(@Query("lat") lat: Double, @Query("lng") lng: Double): NearbyBranchesResponse

    @Multipart
    @POST("me/attendance/checkin")
    suspend fun checkin(
        @Part selfie: MultipartBody.Part,
        @Part("branch_id") branchId: RequestBody,
        @Part("latitude") latitude: RequestBody,
        @Part("longitude") longitude: RequestBody
    ): CheckinResponse

    @GET("me/attendance/month")
    suspend fun month(@Query("month") monthKey: String? = null): MonthSummary

    @GET("me/attendance/history")
    suspend fun history(): HistoryResponse

    @POST("me/attendance/claim")
    suspend fun claim(@Body body: ClaimRequest): ClaimResponse
}
```

- [ ] **Step 2: Register with existing Retrofit setup**

Find the Retrofit builder in the painter module (likely `network/RetrofitClient.kt` or `di/NetworkModule.kt`). Add:
```kotlin
val attendanceApi: AttendanceApi = retrofit.create(AttendanceApi::class.java)
```

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/network/AttendanceApi.kt
git commit -m "feat(attendance): android retrofit interface"
```

---

## Task 21: Android — CheckInScreen Rewrite (CameraX + GPS)

**Files:**
- Modify: `qcpaintshop-android/app/build.gradle`
- Modify: `qcpaintshop-android/app/src/main/AndroidManifest.xml`
- Modify: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInScreen.kt`
- Modify: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInViewModel.kt`

- [ ] **Step 1: Add CameraX + Permissions deps (if absent)**

In `app/build.gradle` under `dependencies`:
```groovy
implementation "androidx.camera:camera-core:1.3.1"
implementation "androidx.camera:camera-camera2:1.3.1"
implementation "androidx.camera:camera-lifecycle:1.3.1"
implementation "androidx.camera:camera-view:1.3.1"
implementation "com.google.accompanist:accompanist-permissions:0.32.0"
implementation "com.google.android.gms:play-services-location:21.0.1"
```

Sync Gradle.

- [ ] **Step 2: Ensure permissions in AndroidManifest.xml**

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

- [ ] **Step 3: Rewrite `CheckInViewModel.kt`**

```kotlin
package com.qcpaintshop.painter.ui.attendance

import android.app.Application
import android.location.Location
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.qcpaintshop.painter.network.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

data class CheckInUiState(
    val loading: Boolean = false,
    val branches: List<NearbyBranch> = emptyList(),
    val selectedBranch: NearbyBranch? = null,
    val location: Location? = null,
    val error: String? = null,
    val success: CheckinResponse? = null
)

class CheckInViewModel(app: Application, private val api: AttendanceApi) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(CheckInUiState())
    val state: StateFlow<CheckInUiState> = _state

    fun onLocationAcquired(loc: Location) {
        _state.value = _state.value.copy(location = loc, loading = true, error = null)
        viewModelScope.launch {
            try {
                val r = api.nearby(loc.latitude, loc.longitude)
                _state.value = _state.value.copy(
                    branches = r.branches,
                    selectedBranch = r.branches.firstOrNull(),
                    loading = false
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }

    fun selectBranch(b: NearbyBranch) {
        _state.value = _state.value.copy(selectedBranch = b)
    }

    fun submit(photoFile: File) {
        val s = _state.value
        if (s.selectedBranch == null || s.location == null) {
            _state.value = s.copy(error = "Missing branch or location")
            return
        }
        _state.value = s.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val req = photoFile.asRequestBody("image/jpeg".toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData("selfie", photoFile.name, req)
                val br = s.selectedBranch.branch_id.toString().toRequestBody()
                val lat = s.location.latitude.toString().toRequestBody()
                val lng = s.location.longitude.toString().toRequestBody()
                val resp = api.checkin(part, br, lat, lng)
                _state.value = _state.value.copy(loading = false, success = resp)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }
}
```

- [ ] **Step 4: Rewrite `CheckInScreen.kt` composable**

```kotlin
package com.qcpaintshop.painter.ui.attendance

import android.Manifest
import android.content.Context
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.android.gms.location.LocationServices
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun CheckInScreen(viewModel: CheckInViewModel, onSuccess: () -> Unit) {
    val ctx = LocalContext.current
    val state by viewModel.state.collectAsState()
    val perms = rememberMultiplePermissionsState(listOf(
        Manifest.permission.CAMERA,
        Manifest.permission.ACCESS_FINE_LOCATION
    ))

    LaunchedEffect(Unit) {
        if (!perms.allPermissionsGranted) perms.launchMultiplePermissionRequest()
    }

    LaunchedEffect(perms.allPermissionsGranted) {
        if (perms.allPermissionsGranted) {
            val fused = LocationServices.getFusedLocationProviderClient(ctx)
            try {
                fused.lastLocation.addOnSuccessListener { loc ->
                    if (loc != null) viewModel.onLocationAcquired(loc)
                }
            } catch (_: SecurityException) {}
        }
    }

    LaunchedEffect(state.success) {
        if (state.success != null) onSuccess()
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        if (!perms.allPermissionsGranted) {
            Text("Camera + Location permissions required.")
            Button(onClick = { perms.launchMultiplePermissionRequest() }) { Text("Grant") }
            return@Column
        }

        Text("Check-in", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))

        state.selectedBranch?.let { br ->
            Text("At: ${br.name} (${br.distance_meters}m)")
        } ?: Text("Locating nearest branch...")

        Spacer(Modifier.height(8.dp))

        // Camera preview
        val previewView = remember { PreviewView(ctx) }
        val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
        val imageCapture = remember { ImageCapture.Builder().build() }
        val lifecycle = LocalLifecycleOwner.current

        LaunchedEffect(Unit) {
            val provider = ProcessCameraProvider.getInstance(ctx).get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            try {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycle, cameraSelector, preview, imageCapture)
            } catch (e: Exception) { Log.e("CheckIn", "camera bind failed", e) }
        }

        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxWidth().height(300.dp))

        Spacer(Modifier.height(12.dp))

        if (state.error != null) {
            Text(state.error!!, color = MaterialTheme.colorScheme.error)
        }

        Button(
            enabled = !state.loading && state.selectedBranch != null,
            onClick = {
                val file = File(ctx.cacheDir, "selfie-${System.currentTimeMillis()}.jpg")
                val out = ImageCapture.OutputFileOptions.Builder(file).build()
                imageCapture.takePicture(
                    out,
                    Executors.newSingleThreadExecutor(),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(r: ImageCapture.OutputFileResults) {
                            viewModel.submit(file)
                        }
                        override fun onError(e: ImageCaptureException) {
                            Log.e("CheckIn", "capture failed", e)
                        }
                    }
                )
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (state.loading) "Submitting..." else "Capture & Submit")
        }
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/build.gradle app/src/main/AndroidManifest.xml app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInScreen.kt app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInViewModel.kt
git commit -m "feat(attendance): android CameraX selfie + GPS check-in"
```

---

## Task 22: Android — AttendanceHistoryScreen

**Files:**
- Create: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/attendance/AttendanceViewModel.kt`
- Create: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/attendance/AttendanceHistoryScreen.kt`

- [ ] **Step 1: ViewModel**

```kotlin
package com.qcpaintshop.painter.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.qcpaintshop.painter.network.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AttendanceUi(
    val month: MonthSummary? = null,
    val history: List<HistoryRow> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val justClaimed: Int? = null
)

class AttendanceViewModel(private val api: AttendanceApi) : ViewModel() {
    private val _state = MutableStateFlow(AttendanceUi())
    val state: StateFlow<AttendanceUi> = _state

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val m = api.month(null)
                val h = api.history()
                _state.value = _state.value.copy(month = m, history = h.history, loading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }

    fun claim(monthKey: String) {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val r = api.claim(ClaimRequest(monthKey))
                _state.value = _state.value.copy(loading = false, justClaimed = r.claimed_ap)
                load()
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }
}
```

- [ ] **Step 2: Screen composable**

```kotlin
package com.qcpaintshop.painter.ui.attendance

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun AttendanceHistoryScreen(viewModel: AttendanceViewModel, onCheckInClick: () -> Unit) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.load() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("Attendance", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(12.dp))

        state.month?.let { m ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("This month: ${m.month_key}", style = MaterialTheme.typography.titleMedium)
                    Text("${m.total_checkins} check-ins · ${m.total_ap_earned} AP earned")
                    Text("₹${m.monthly_customer_billed_preview.toInt()} billed → ${m.claim_pct_preview}% = ${m.claimable_ap_preview} AP claimable")

                    if (m.claim_status == "available" && m.claimable_ap_preview > 0) {
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { viewModel.claim(m.month_key) }) {
                            Text("Claim ${m.claimable_ap_preview} AP")
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = onCheckInClick) { Text("Check in Today") }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("History", style = MaterialTheme.typography.titleLarge)
        state.history.forEach { h ->
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(h.month_key, style = MaterialTheme.typography.titleMedium)
                    Text("${h.total_checkins} check-ins · ${h.total_ap_earned} AP")
                    Text("Billed ₹${h.monthly_customer_billed.toInt()} → ${h.claim_pct}%")
                    Text("Status: ${h.claim_status} · Claimed: ${h.ap_claimed}")
                }
            }
        }

        state.justClaimed?.let {
            Spacer(Modifier.height(8.dp))
            Text("✓ Claimed $it AP", style = MaterialTheme.typography.titleMedium)
        }
        state.error?.let {
            Text("Error: $it", color = MaterialTheme.colorScheme.error)
        }
    }
}
```

- [ ] **Step 3: Register in nav graph**

Find the painter `NavHost` (likely `MainActivity.kt` or `PainterNavGraph.kt`) and add a new route:
```kotlin
composable("attendance") {
    val vm: AttendanceViewModel = viewModel(factory = AttendanceViewModelFactory(attendanceApi))
    AttendanceHistoryScreen(vm, onCheckInClick = { navController.navigate("checkin") })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/attendance/AttendanceViewModel.kt app/src/painter/java/com/qcpaintshop/painter/ui/attendance/AttendanceHistoryScreen.kt
git commit -m "feat(attendance): android attendance history screen + claim"
```

---

## Task 23: Android — HomeScreen HeroCard AP Row

**Files:**
- Modify: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt`
- Modify: `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt`

- [ ] **Step 1: Add state field in `HomeViewModel`**

```kotlin
data class HomeUi(
    // ... existing fields
    val attendanceMonth: MonthSummary? = null
)

// In loadHome() / init fetch:
viewModelScope.launch {
    try {
        val m = attendanceApi.month(null)
        _state.value = _state.value.copy(attendanceMonth = m)
    } catch (_: Exception) {}
}
```

- [ ] **Step 2: Add AP row inside HeroCard composable**

In `HomeScreen.kt`, inside the `HeroCard(...)` composable after the existing points row:
```kotlin
state.attendanceMonth?.let { m ->
    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Attendance", style = MaterialTheme.typography.labelMedium)
            Text("${m.total_checkins} × 100 = ${m.total_ap_earned} AP",
                style = MaterialTheme.typography.titleSmall)
            Text("≈ ${m.claimable_ap_preview} claimable",
                style = MaterialTheme.typography.bodySmall)
        }
        if (m.claim_status == "available" && m.claimable_ap_preview > 0) {
            Button(onClick = { onNavigate("attendance") }) {
                Text("Claim ${m.claimable_ap_preview}")
            }
        } else {
            OutlinedButton(onClick = { onNavigate("checkin") }) {
                Text("Check in")
            }
        }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt
git commit -m "feat(attendance): android HeroCard AP row + conditional claim/checkin CTA"
```

---

## Task 24: End-to-End Smoke Test + Deploy Prep

- [ ] **Step 1: Run all unit tests**

Run: `npx jest tests/unit/painter-attendance.test.js`
Expected: all PASS.

- [ ] **Step 2: Run integration test**

Run: `npx jest tests/integration/painter-attendance-flow.test.js --runInBand`
Expected: all PASS.

- [ ] **Step 3: Flip feature flag off for initial deploy**

```bash
mysql -u root -p business_manager -e "UPDATE ai_config SET config_value='0' WHERE config_key='painter_attendance_enabled';"
```

Run the migration + restart server:
```bash
node migrations/migrate-painter-attendance.js
pm2 restart business-manager
```

- [ ] **Step 4: Internal smoke — one painter, one branch**

1. Admin sets GPS on one test branch.
2. Enable flag: `UPDATE ai_config SET config_value='1' WHERE config_key='painter_attendance_enabled';`
3. Test painter: install APK, login, check-in at the branch.
4. Admin: verify row appears in Attendance → Today tab.
5. Seed `painter_estimates` test data for that painter + current month (if safe) to test claim preview.
6. Manually run `openMonthlyClaim` for current month: `node -e "require('./services/painter-attendance-service').setPool(require('./config/database').pool); require('./services/painter-attendance-service').openMonthlyClaim('YYYY-MM').then(console.log).catch(console.error)"`.
7. Painter: click Claim → verify AP credited to regular pool.

- [ ] **Step 5: Commit any fixes + final commit**

```bash
git commit -am "chore(attendance): smoke test + deploy prep"
```

- [ ] **Step 6: Deploy**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && node migrations/migrate-painter-attendance.js && pm2 restart business-manager"
```

- [ ] **Step 7: Build painter APK + upload to Play Store internal track**

Standard painter APK build process per `google-services/publish-painter.js`. Bump `versionCode` and `versionName` in painter flavor.

---

## Acceptance Checklist

- [ ] Migration creates all 4 tables + 7 config rows idempotently
- [ ] Painter cannot check in twice on same day (409)
- [ ] Painter cannot check in outside 300m geofence (400 with closest branch hint)
- [ ] Each check-in credits exactly 100 AP in ledger
- [ ] `recomputeMonthly` correctly rolls up approved check-ins only
- [ ] `openMonthlyClaim` cron sets status=available + correct `claimable_ap`
- [ ] `claimMonth` transfers AP to regular pool via `painter-points-engine.addPoints`
- [ ] Unclaimed AP becomes `forfeited` after 7-day window
- [ ] Selfie files are deleted on 8th of next month
- [ ] Admin can reject a check-in → AP clawed back; if month already claimed, pending row created
- [ ] `pending_clawback` rows are netted on next `addPoints` to regular pool
- [ ] Android CheckInScreen captures selfie, gets GPS, submits multipart, shows success
- [ ] Android HomeScreen HeroCard shows AP summary + correct CTA (Check-in vs Claim)
- [ ] Admin Attendance tab shows Today + Monthly sub-views with selfie thumbnails + reject action
