# Painter Retention System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make painters open the QC Painters app daily through habit-forming mechanics — levels, streaks, and a dynamic morning briefing card.

**Architecture:** Add 3 interlocking features to existing painter system: (1) Level tiers with point multipliers, (2) daily streak tracking with milestone bonuses, (3) morning briefing card replacing static balance cards. All backed by 2 new tables + 5 new columns on `painters` + 4 cron jobs + 2 new API endpoints.

**Tech Stack:** Express.js, MySQL, node-cron, Sharp (SVG card badges), Tailwind CSS, vanilla JS, FCM push notifications.

**Spec:** `docs/superpowers/specs/2026-03-13-painter-retention-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/migrate-painter-retention.js` | CREATE | Tables, columns, config seeds |
| `services/painter-points-engine.js` | MODIFY | `getLevelMultiplier()`, `addPointsWithMultiplier()`, `checkLevelUp()` |
| `services/painter-scheduler.js` | MODIFY | 4 new cron jobs (streak reset, bonus rotation, daily bonus push, streak reminder) |
| `services/painter-notification-service.js` | MODIFY | 4 new notification types with Tamil translations |
| `services/painter-card-generator.js` | MODIFY | Level badge SVG on visiting + ID cards |
| `routes/painters.js` | MODIFY | `PUT /me/daily-streak`, `GET /me/briefing`, modify `GET /me/dashboard` |
| `public/painter-dashboard.html` | MODIFY | Briefing card, streak flame, level badge, celebrations |

---

## Chunk 1: Migration + Level Engine

### Task 1: Create Migration File

**Files:**
- Create: `migrations/migrate-painter-retention.js`

- [ ] **Step 1: Write migration file**

```javascript
/**
 * Painter Retention Migration
 * - painter_daily_checkins table
 * - painter_levels config table (seeded)
 * - painters table new columns
 * - painter_point_transactions source ENUM expansion
 * - ai_config keys
 */
async function up(pool) {
    // 1. painter_daily_checkins
    const [tables1] = await pool.query("SHOW TABLES LIKE 'painter_daily_checkins'");
    if (!tables1.length) {
        await pool.query(`
            CREATE TABLE painter_daily_checkins (
                painter_id      INT NOT NULL,
                checkin_date    DATE NOT NULL,
                streak_count    INT NOT NULL DEFAULT 1,
                bonus_awarded   DECIMAL(10,2) DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (painter_id, checkin_date),
                FOREIGN KEY (painter_id) REFERENCES painters(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  Created painter_daily_checkins table');
    }

    // 2. painter_levels
    const [tables2] = await pool.query("SHOW TABLES LIKE 'painter_levels'");
    if (!tables2.length) {
        await pool.query(`
            CREATE TABLE painter_levels (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                level_name      VARCHAR(20) NOT NULL UNIQUE,
                min_points      INT NOT NULL,
                multiplier      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
                badge_color     VARCHAR(7) NOT NULL,
                sort_order      INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            INSERT INTO painter_levels (level_name, min_points, multiplier, badge_color, sort_order) VALUES
            ('bronze',  0,      1.00, '#CD7F32', 1),
            ('silver',  5000,   1.20, '#9CA3AF', 2),
            ('gold',    25000,  1.50, '#D4A24E', 3),
            ('diamond', 100000, 2.00, '#3B82F6', 4)
        `);
        console.log('  Created painter_levels table with seed data');
    }

    // 3. painters table columns
    const colsToAdd = [
        { col: 'current_level',    def: "VARCHAR(20) DEFAULT 'bronze'" },
        { col: 'current_streak',   def: "INT DEFAULT 0" },
        { col: 'last_checkin_date', def: "DATE NULL" },
        { col: 'longest_streak',   def: "INT DEFAULT 0" },
        { col: 'last_briefing_at', def: "TIMESTAMP NULL" }
    ];
    for (const { col, def } of colsToAdd) {
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters' AND COLUMN_NAME = ?",
            [col]
        );
        if (!cols.length) {
            await pool.query(`ALTER TABLE painters ADD COLUMN ${col} ${def}`);
            console.log(`  Added painters.${col}`);
        }
    }

    // 4. Expand painter_point_transactions source ENUM
    try {
        await pool.query(`
            ALTER TABLE painter_point_transactions MODIFY source
                ENUM('self_billing','customer_billing','referral','attendance','monthly_slab',
                     'quarterly_slab','withdrawal','credit_debit','admin_adjustment',
                     'streak_bonus','daily_bonus') NOT NULL
        `);
        console.log('  Updated painter_point_transactions source ENUM');
    } catch (e) {
        // May already have the values
        if (!e.message.includes('Duplicate')) console.log('  ENUM update skipped:', e.message);
    }

    // 5. ai_config keys
    const configKeys = [
        { key: 'painter_daily_bonus_product_id', val: '' },
        { key: 'painter_daily_bonus_multiplier', val: '2' },
        { key: 'painter_daily_bonus_cap', val: '500' },
        { key: 'painter_streak_reminder_enabled', val: '1' }
    ];
    for (const { key, val } of configKeys) {
        const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
        if (!existing.length) {
            await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, val]);
            console.log(`  Inserted ai_config: ${key}`);
        }
    }

    // 6. Backfill current_level for existing painters based on lifetime points
    await pool.query(`
        UPDATE painters p
        SET current_level = (
            SELECT pl.level_name
            FROM painter_levels pl
            WHERE (p.total_earned_regular + p.total_earned_annual) >= pl.min_points
            ORDER BY pl.min_points DESC
            LIMIT 1
        )
        WHERE current_level = 'bronze' OR current_level IS NULL
    `);
    console.log('  Backfilled painter levels');

    console.log('[Migration] Painter retention migration complete');
}

module.exports = { up };
```

- [ ] **Step 2: Run migration**

Run: `node migrate.js`
Expected: All tables/columns/configs created successfully.

- [ ] **Step 3: Verify migration**

Run: `node migrate.js --status`
Expected: `migrate-painter-retention.js` shows as applied.

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-painter-retention.js
git commit -m "feat(painter): add retention system migration — levels, streaks, checkins tables"
```

---

### Task 2: Level Multiplier Logic in Points Engine

**Files:**
- Modify: `services/painter-points-engine.js` (lines 463-478 exports area)

- [ ] **Step 1: Add `getLevelMultiplier()` function**

Add BEFORE the `module.exports` block (before line 463):

```javascript
// ═══════════════════════════════════════════
// LEVEL SYSTEM
// ═══════════════════════════════════════════

async function getLevelMultiplier(painterId) {
    const [rows] = await pool.query(
        `SELECT pl.multiplier FROM painters p
         JOIN painter_levels pl ON pl.level_name = p.current_level
         WHERE p.id = ?`,
        [painterId]
    );
    return rows.length ? parseFloat(rows[0].multiplier) : 1.0;
}

async function addPointsWithMultiplier(painterId, pointPool, baseAmount, source, refId, refType, description, createdBy) {
    const multiplier = await getLevelMultiplier(painterId);
    const adjustedAmount = Math.round(baseAmount * multiplier * 100) / 100;
    const result = await addPoints(painterId, pointPool, adjustedAmount, source, refId, refType,
        multiplier > 1 ? `${description} (${multiplier}x level bonus)` : description, createdBy);
    // Check for level-up after awarding points — sends notification if leveled up
    const levelUp = await checkLevelUp(painterId);
    if (levelUp) {
        // Send level-up notification (async, non-blocking)
        try {
            const painterNotificationService = require('./painter-notification-service');
            const [lvl] = await pool.query('SELECT multiplier FROM painter_levels WHERE level_name = ?', [levelUp.newLevel]);
            const notif = painterNotificationService.getRetentionNotification('level_up', levelUp.newLevel, lvl[0]?.multiplier || 1);
            painterNotificationService.sendToPainter(painterId, notif).catch(e =>
                console.error(`[Points] Level-up notification failed:`, e.message)
            );
        } catch (e) { /* notification service may not be initialized yet */ }
    }
    return { balance: result, levelUp };
}

async function checkLevelUp(painterId) {
    const [painter] = await pool.query(
        'SELECT current_level, total_earned_regular, total_earned_annual, full_name FROM painters WHERE id = ?',
        [painterId]
    );
    if (!painter.length) return null;

    const p = painter[0];
    const lifetime = parseFloat(p.total_earned_regular) + parseFloat(p.total_earned_annual);

    const [levels] = await pool.query(
        'SELECT * FROM painter_levels WHERE min_points <= ? ORDER BY min_points DESC LIMIT 1',
        [lifetime]
    );
    if (!levels.length) return null;

    const newLevel = levels[0].level_name;
    if (newLevel !== p.current_level) {
        await pool.query('UPDATE painters SET current_level = ?, card_generated_at = NULL, id_card_generated_at = NULL WHERE id = ?', [newLevel, painterId]);
        return { previousLevel: p.current_level, newLevel, painterName: p.full_name };
    }
    return null;
}
```

- [ ] **Step 2: Update `processInvoice()` to use multiplier for regular + annual points**

In `processInvoice()` (lines 180-186), replace the direct `addPoints()` calls with `addPointsWithMultiplier()`:

Replace lines 180-186:
```javascript
    // Award points
    if (totalRegularPoints > 0) {
        await addPoints(painterId, 'regular', totalRegularPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
    if (totalAnnualPoints > 0) {
        await addPoints(painterId, 'annual', totalAnnualPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
```

With:
```javascript
    // Award points (with level multiplier)
    if (totalRegularPoints > 0) {
        await addPointsWithMultiplier(painterId, 'regular', totalRegularPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
    if (totalAnnualPoints > 0) {
        await addPointsWithMultiplier(painterId, 'annual', totalAnnualPoints, billingType === 'self' ? 'self_billing' : 'customer_billing',
            invoice.invoice_id, 'invoice', `Invoice ${invoice.invoice_number || invoice.invoice_id}`, createdBy);
    }
```

**NOTE:** Referral points (lines 202-205) stay as `addPoints()` — referral tier has its own scaling. Slab bonuses (line 303) also stay as `addPoints()` per spec.

- [ ] **Step 3: Update `awardAttendancePoints()` to use multiplier**

Replace lines 444-446:
```javascript
    if (points > 0) {
        await addPoints(painterId, 'regular', points, 'attendance',
            String(attendanceId), 'attendance', 'Attendance points', null);
    }
```

With:
```javascript
    if (points > 0) {
        await addPointsWithMultiplier(painterId, 'regular', points, 'attendance',
            String(attendanceId), 'attendance', 'Attendance points', null);
    }
```

- [ ] **Step 4: Export new functions**

Update `module.exports` (line 463):
```javascript
module.exports = {
    setPool,
    getReferralTier,
    getBalance,
    addPoints,
    deductPoints,
    getLedger,
    processInvoice,
    evaluateMonthlySlabs,
    evaluateQuarterlySlabs,
    checkOverdueCredits,
    requestWithdrawal,
    processWithdrawal,
    awardAttendancePoints,
    generateReferralCode,
    getLevelMultiplier,
    addPointsWithMultiplier,
    checkLevelUp
};
```

- [ ] **Step 5: Verify server starts**

Run: `node -e "require('./services/painter-points-engine')"`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add services/painter-points-engine.js
git commit -m "feat(painter): add level multiplier system to points engine"
```

---

## Chunk 2: Notification Types + Scheduler Crons

### Task 3: Add Notification Types

**Files:**
- Modify: `services/painter-notification-service.js` (add helper at bottom, before `module.exports` line 244)

- [ ] **Step 1: Add retention notification helpers**

Add before `module.exports` (line 244):

```javascript
// ═══════════════════════════════════════════
// RETENTION NOTIFICATION HELPERS
// ═══════════════════════════════════════════

const RETENTION_NOTIFICATIONS = {
    streak_milestone: (days, points) => ({
        type: 'streak_milestone',
        title: `${days}-day streak! ${points} bonus points added!`,
        title_ta: `${days}-நாள் தொடர்! ${points} போனஸ் புள்ளிகள் சேர்க்கப்பட்டது!`,
        body: days >= 30 ? `Incredible! You've kept a ${days}-day streak. ${points} points added to your wallet!`
            : days >= 14 ? `2 week warrior! ${points} bonus points earned!`
            : days >= 7 ? `1 week streak! You're on fire! ${points} bonus points!`
            : `${days}-day streak! Keep going! ${points} bonus points!`,
        body_ta: `${days}-நாள் தொடர்! ${points} போனஸ் புள்ளிகள் உங்கள் வாலட்டில்!`,
        data: { screen: 'dashboard', streak: days, points }
    }),

    streak_at_risk: (days) => ({
        type: 'streak_at_risk',
        title: `Your ${days}-day streak is at risk!`,
        title_ta: `உங்கள் ${days}-நாள் தொடர் ஆபத்தில்!`,
        body: 'Open the app to keep it alive',
        body_ta: 'அதை காப்பாற்ற ஆப்பை திறக்கவும்',
        data: { screen: 'dashboard', streak: days }
    }),

    level_up: (newLevel, multiplier) => ({
        type: 'level_up',
        title: `You've reached ${newLevel.charAt(0).toUpperCase() + newLevel.slice(1)} level!`,
        title_ta: `நீங்கள் ${newLevel} நிலையை அடைந்தீர்கள்!`,
        body: `All earnings now get ${multiplier}x multiplier!`,
        body_ta: `அனைத்து வருமானமும் ${multiplier}x பெருக்கி பெறும்!`,
        data: { screen: 'dashboard', level: newLevel, multiplier }
    }),

    daily_bonus: (productName, multiplier) => ({
        type: 'daily_bonus',
        title: `Today's bonus: ${multiplier}x points on ${productName}!`,
        title_ta: `இன்றைய போனஸ்: ${productName} மீது ${multiplier}x புள்ளிகள்!`,
        body: 'Offer ends midnight. Open app for details.',
        body_ta: 'நள்ளிரவில் முடிவடையும். விவரங்களுக்கு ஆப்பை திறக்கவும்.',
        data: { screen: 'dashboard', type: 'daily_bonus' }
    })
};

function getRetentionNotification(type, ...args) {
    const builder = RETENTION_NOTIFICATIONS[type];
    if (!builder) throw new Error(`Unknown retention notification type: ${type}`);
    return builder(...args);
}
```

- [ ] **Step 2: Export the helper**

Update `module.exports` (line 244):
```javascript
module.exports = {
    setDependencies,
    sendToPainter,
    sendToAll,
    getNotifications,
    markRead,
    getRetentionNotification
};
```

- [ ] **Step 3: Commit**

```bash
git add services/painter-notification-service.js
git commit -m "feat(painter): add retention notification types (streak, level, daily bonus)"
```

---

### Task 4: Add 4 Cron Jobs to Scheduler

**Files:**
- Modify: `services/painter-scheduler.js`

- [ ] **Step 1: Add notification service import**

Add after line 9 (`const pointsEngine = require('./painter-points-engine');`):

```javascript
const painterNotificationService = require('./painter-notification-service');
```

- [ ] **Step 2: Add 4 new job runner functions**

Add after `runCreditOverdueCheck()` (after line 94), before the `start()` function:

```javascript
// ─── Retention Job Runners ────────────────────────────────────

async function runStreakReset() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Running midnight streak reset...');
        if (registry) registry.markRunning('painter-streak-reset');

        // Reset streaks for painters who didn't check in yesterday
        // Use IST date for comparison
        const [result] = await pool.query(`
            UPDATE painters
            SET current_streak = 0
            WHERE current_streak > 0
              AND (last_checkin_date IS NULL OR last_checkin_date < DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30')) - INTERVAL 1 DAY)
        `);

        console.log(`[Painter Scheduler] Streak reset: ${result.affectedRows} painters reset`);
        if (registry) registry.markCompleted('painter-streak-reset', { recordsProcessed: result.affectedRows });
    } catch (error) {
        console.error('[Painter Scheduler] Streak reset failed:', error.message);
        if (registry) registry.markFailed('painter-streak-reset', { error: error.message });
    }
}

async function runDailyBonusRotation() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Rotating daily bonus product...');
        if (registry) registry.markRunning('painter-bonus-rotation');

        // Pick random active product
        const [products] = await pool.query(
            "SELECT id, name FROM products WHERE status = 'active' ORDER BY RAND() LIMIT 1"
        );
        if (products.length) {
            const multiplier = Math.random() < 0.5 ? 2 : 3;
            await pool.query("UPDATE ai_config SET config_value = ? WHERE config_key = 'painter_daily_bonus_product_id'", [String(products[0].id)]);
            await pool.query("UPDATE ai_config SET config_value = ? WHERE config_key = 'painter_daily_bonus_multiplier'", [String(multiplier)]);
            console.log(`[Painter Scheduler] Bonus product: ${products[0].name} (${multiplier}x)`);
        }

        if (registry) registry.markCompleted('painter-bonus-rotation', { product: products[0]?.name });
    } catch (error) {
        console.error('[Painter Scheduler] Bonus rotation failed:', error.message);
        if (registry) registry.markFailed('painter-bonus-rotation', { error: error.message });
    }
}

async function runDailyBonusPush() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Sending daily bonus push...');
        if (registry) registry.markRunning('painter-daily-bonus-push');

        const productId = await getConfig('painter_daily_bonus_product_id');
        const multiplier = await getConfig('painter_daily_bonus_multiplier') || '2';
        if (!productId) { console.log('[Painter Scheduler] No bonus product set, skipping'); return; }

        const [product] = await pool.query('SELECT name FROM products WHERE id = ?', [productId]);
        if (!product.length) return;

        const notif = painterNotificationService.getRetentionNotification('daily_bonus', product[0].name, multiplier);
        const results = await painterNotificationService.sendToAll(notif);

        console.log(`[Painter Scheduler] Daily bonus push sent to ${results.length} painters`);
        if (registry) registry.markCompleted('painter-daily-bonus-push', { sent: results.length });
    } catch (error) {
        console.error('[Painter Scheduler] Daily bonus push failed:', error.message);
        if (registry) registry.markFailed('painter-daily-bonus-push', { error: error.message });
    }
}

async function runStreakReminder() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        const reminderEnabled = await getConfig('painter_streak_reminder_enabled');
        if (reminderEnabled !== '1') return;

        console.log('[Painter Scheduler] Sending streak-at-risk reminders...');
        if (registry) registry.markRunning('painter-streak-reminder');

        // Find painters with streak > 0 who haven't checked in today (IST)
        const [painters] = await pool.query(`
            SELECT id, current_streak FROM painters
            WHERE status = 'approved'
              AND current_streak > 0
              AND (last_checkin_date IS NULL OR last_checkin_date < DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30')))
        `);

        let sent = 0;
        for (const painter of painters) {
            try {
                const notif = painterNotificationService.getRetentionNotification('streak_at_risk', painter.current_streak);
                await painterNotificationService.sendToPainter(painter.id, notif);
                sent++;
            } catch (e) {
                console.error(`[Painter Scheduler] Streak reminder failed for painter ${painter.id}:`, e.message);
            }
        }

        console.log(`[Painter Scheduler] Streak reminders sent: ${sent}/${painters.length}`);
        if (registry) registry.markCompleted('painter-streak-reminder', { sent, total: painters.length });
    } catch (error) {
        console.error('[Painter Scheduler] Streak reminder failed:', error.message);
        if (registry) registry.markFailed('painter-streak-reminder', { error: error.message });
    }
}
```

- [ ] **Step 3: Register and schedule new crons in `start()`**

Replace the `start()` function (lines 98-116):

```javascript
function start() {
    // Register automations
    if (registry) {
        registry.register('painter-monthly-slabs', { name: 'Monthly Slab Eval', service: 'painter-scheduler', schedule: '0 6 1 * *', description: 'Monthly painter value slab evaluation' });
        registry.register('painter-quarterly-slabs', { name: 'Quarterly Slab Eval', service: 'painter-scheduler', schedule: '30 6 1 1,4,7,10 *', description: 'Quarterly painter slab evaluation' });
        registry.register('painter-credit-check', { name: 'Credit Overdue Check', service: 'painter-scheduler', schedule: '0 8 * * *', description: 'Daily painter credit overdue check' });
        registry.register('painter-streak-reset', { name: 'Streak Reset', service: 'painter-scheduler', schedule: '0 0 * * *', description: 'Midnight streak reset for inactive painters' });
        registry.register('painter-bonus-rotation', { name: 'Bonus Rotation', service: 'painter-scheduler', schedule: '5 0 * * *', description: 'Rotate daily bonus product at midnight' });
        registry.register('painter-daily-bonus-push', { name: 'Daily Bonus Push', service: 'painter-scheduler', schedule: '0 7 * * *', description: '7 AM daily bonus product notification' });
        registry.register('painter-streak-reminder', { name: 'Streak Reminder', service: 'painter-scheduler', schedule: '0 20 * * *', description: '8 PM streak-at-risk reminder' });
    }

    // Existing jobs
    jobs.monthlySlabs = cron.schedule('0 6 1 * *', runMonthlySlabEvaluation, { timezone: 'Asia/Kolkata' });
    jobs.quarterlySlabs = cron.schedule('30 6 1 1,4,7,10 *', runQuarterlySlabEvaluation, { timezone: 'Asia/Kolkata' });
    jobs.creditCheck = cron.schedule('0 8 * * *', runCreditOverdueCheck, { timezone: 'Asia/Kolkata' });

    // Retention jobs
    jobs.streakReset = cron.schedule('0 0 * * *', runStreakReset, { timezone: 'Asia/Kolkata' });
    jobs.bonusRotation = cron.schedule('5 0 * * *', runDailyBonusRotation, { timezone: 'Asia/Kolkata' });
    jobs.dailyBonusPush = cron.schedule('0 7 * * *', runDailyBonusPush, { timezone: 'Asia/Kolkata' });
    jobs.streakReminder = cron.schedule('0 20 * * *', runStreakReminder, { timezone: 'Asia/Kolkata' });

    console.log('[Painter Scheduler] Started: monthly-slabs(1st 6AM), quarterly-slabs(Q1 6:30AM), credit-check(daily 8AM), streak-reset(midnight), bonus-rotation(00:05), daily-bonus-push(7AM), streak-reminder(8PM)');
}
```

- [ ] **Step 4: Export new runners**

Update `module.exports` (line 123):
```javascript
module.exports = {
    setPool,
    setAutomationRegistry,
    start,
    stop,
    runMonthlySlabEvaluation,
    runQuarterlySlabEvaluation,
    runCreditOverdueCheck,
    runStreakReset,
    runDailyBonusRotation,
    runDailyBonusPush,
    runStreakReminder
};
```

- [ ] **Step 5: Verify server starts**

Run: `node -e "require('./services/painter-scheduler')"`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add services/painter-scheduler.js
git commit -m "feat(painter): add 4 retention cron jobs — streak reset, bonus rotation, daily push, streak reminder"
```

---

## Chunk 3: API Endpoints (Streak + Briefing)

### Task 5: Add `PUT /me/daily-streak` Endpoint

**Files:**
- Modify: `routes/painters.js` — Add after `GET /me/dashboard` endpoint (after line 610)

- [ ] **Step 1: Add daily streak endpoint**

Add after the `GET /me/dashboard` closing `});` (line 610):

```javascript
// ═══════════════════════════════════════════
// DAILY STREAK CHECK-IN
// ═══════════════════════════════════════════

router.put('/me/daily-streak', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;
        const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`;

        // Check if already checked in today (idempotent)
        const [existing] = await pool.query(
            'SELECT streak_count, bonus_awarded FROM painter_daily_checkins WHERE painter_id = ? AND checkin_date = ?',
            [painterId, todayStr]
        );
        if (existing.length) {
            // Already checked in — return current state
            const [painter] = await pool.query(
                'SELECT current_streak, longest_streak, current_level FROM painters WHERE id = ?',
                [painterId]
            );
            return res.json({
                success: true,
                alreadyCheckedIn: true,
                streak: painter[0].current_streak,
                longestStreak: painter[0].longest_streak,
                level: painter[0].current_level
            });
        }

        // Get painter's last check-in
        const [painter] = await pool.query(
            'SELECT current_streak, longest_streak, last_checkin_date, current_level FROM painters WHERE id = ?',
            [painterId]
        );
        if (!painter.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const p = painter[0];
        let newStreak = 1;

        // Check if yesterday was last check-in (consecutive day)
        if (p.last_checkin_date) {
            const lastDate = new Date(p.last_checkin_date);
            const yesterday = new Date(todayIST);
            yesterday.setDate(yesterday.getDate() - 1);

            if (lastDate.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10)) {
                newStreak = p.current_streak + 1;
            }
            // If last_checkin_date IS today (race condition), keep current streak
            else if (lastDate.toISOString().slice(0, 10) === todayStr) {
                newStreak = p.current_streak;
            }
            // Otherwise streak resets to 1
        }

        const newLongest = Math.max(newStreak, p.longest_streak || 0);

        // Determine milestone bonus
        const MILESTONES = { 3: 10, 7: 50, 14: 150, 30: 500 };
        let bonusAwarded = 0;
        let milestoneHit = null;

        // Check if this streak count hits a milestone
        if (MILESTONES[newStreak]) {
            bonusAwarded = MILESTONES[newStreak];
            milestoneHit = newStreak;
        } else if (newStreak > 30 && newStreak % 30 === 0) {
            // Repeating 500pts every 30 days after initial 30
            bonusAwarded = 500;
            milestoneHit = newStreak;
        }

        // Insert check-in record
        await pool.query(
            'INSERT INTO painter_daily_checkins (painter_id, checkin_date, streak_count, bonus_awarded) VALUES (?, ?, ?, ?)',
            [painterId, todayStr, newStreak, bonusAwarded]
        );

        // Update painter record
        await pool.query(
            'UPDATE painters SET current_streak = ?, longest_streak = ?, last_checkin_date = ? WHERE id = ?',
            [newStreak, newLongest, todayStr, painterId]
        );

        // Award milestone bonus (with level multiplier — also handles level-up notification internally)
        let levelUp = null;
        if (bonusAwarded > 0) {
            const result = await pointsEngine.addPointsWithMultiplier(
                painterId, 'regular', bonusAwarded, 'streak_bonus',
                todayStr, 'streak', `${newStreak}-day streak bonus`, null
            );
            levelUp = result.levelUp; // Set if level changed (notification already sent by engine)

            // Send milestone notification
            const notif = painterNotificationService.getRetentionNotification('streak_milestone', newStreak, bonusAwarded);
            painterNotificationService.sendToPainter(painterId, notif).catch(e =>
                console.error(`[Streak] Milestone notification failed:`, e.message)
            );
        }

        res.json({
            success: true,
            alreadyCheckedIn: false,
            streak: newStreak,
            longestStreak: newLongest,
            bonusAwarded,
            milestoneHit,
            levelUp,
            level: levelUp ? levelUp.newLevel : p.current_level
        });
    } catch (error) {
        console.error('[Streak] Check-in error:', error);
        res.status(500).json({ success: false, message: 'Failed to record streak' });
    }
});
```

- [ ] **Step 2: Add `painterNotificationService` import at top of painters.js**

Near the top of `routes/painters.js`, find the existing `require` for `painterNotificationService` (it's imported around line 5-10). If not present, add:

```javascript
const painterNotificationService = require('../services/painter-notification-service');
```

Note: The `pointsEngine` is already imported. Verify both are available at the top of the file.

- [ ] **Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat(painter): add PUT /me/daily-streak endpoint with milestone bonuses"
```

---

### Task 6: Add `GET /me/briefing` Endpoint

**Files:**
- Modify: `routes/painters.js` — Add after the daily-streak endpoint

- [ ] **Step 1: Add briefing endpoint**

Add right after the `PUT /me/daily-streak` endpoint:

```javascript
// ═══════════════════════════════════════════
// MORNING BRIEFING
// ═══════════════════════════════════════════

router.get('/me/briefing', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;

        // Get painter data
        const [painter] = await pool.query(
            `SELECT current_level, current_streak, longest_streak, last_checkin_date, last_briefing_at,
                    total_earned_regular, total_earned_annual, regular_points, annual_points, full_name
             FROM painters WHERE id = ?`,
            [painterId]
        );
        if (!painter.length) return res.status(404).json({ success: false, message: 'Painter not found' });
        const p = painter[0];

        // 1. "What you earned" — points since last briefing
        const lastBriefing = p.last_briefing_at || new Date(0);
        const [recentPoints] = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as earned
             FROM painter_point_transactions
             WHERE painter_id = ? AND type = 'earn' AND created_at > ?`,
            [painterId, lastBriefing]
        );
        const earnedSinceLastVisit = parseFloat(recentPoints[0].earned);

        // Pending estimate status changes since last briefing
        const [estimateUpdates] = await pool.query(
            `SELECT id, estimate_number, status, updated_at
             FROM painter_estimates
             WHERE painter_id = ? AND updated_at > ?
             ORDER BY updated_at DESC LIMIT 5`,
            [painterId, lastBriefing]
        );

        // Withdrawal status updates since last briefing
        const [withdrawalUpdates] = await pool.query(
            `SELECT id, pool, amount, status, processed_at
             FROM painter_withdrawals
             WHERE painter_id = ? AND (processed_at > ? OR requested_at > ?)
             ORDER BY COALESCE(processed_at, requested_at) DESC LIMIT 5`,
            [painterId, lastBriefing, lastBriefing]
        );

        // 2. "Today's opportunity" — daily bonus product
        const [bonusConfig] = await pool.query(
            "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('painter_daily_bonus_product_id', 'painter_daily_bonus_multiplier', 'painter_daily_bonus_cap')"
        );
        const cfg = {};
        bonusConfig.forEach(c => { cfg[c.config_key] = c.config_value; });

        let dailyBonus = null;
        if (cfg.painter_daily_bonus_product_id) {
            const [product] = await pool.query(
                'SELECT id, name, brand, category, image_url FROM products WHERE id = ?',
                [cfg.painter_daily_bonus_product_id]
            );
            if (product.length) {
                // Calculate remaining hours until midnight IST
                const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
                const midnightIST = new Date(nowIST);
                midnightIST.setHours(24, 0, 0, 0);
                const hoursLeft = Math.max(0, Math.round((midnightIST - nowIST) / (1000 * 60 * 60) * 10) / 10);

                dailyBonus = {
                    product: product[0],
                    multiplier: parseInt(cfg.painter_daily_bonus_multiplier) || 2,
                    cap: parseInt(cfg.painter_daily_bonus_cap) || 500,
                    hoursLeft
                };
            }
        }

        // 3. "Your progress" — level + streak
        const lifetime = parseFloat(p.total_earned_regular) + parseFloat(p.total_earned_annual);
        const [levels] = await pool.query('SELECT * FROM painter_levels ORDER BY min_points ASC');
        const currentLevelData = levels.find(l => l.level_name === p.current_level) || levels[0];
        const nextLevel = levels.find(l => l.min_points > lifetime);

        const levelProgress = nextLevel ? {
            current: p.current_level,
            next: nextLevel.level_name,
            currentPoints: lifetime,
            nextThreshold: nextLevel.min_points,
            percentage: Math.min(100, Math.round((lifetime / nextLevel.min_points) * 100)),
            pointsNeeded: nextLevel.min_points - lifetime,
            nextMultiplier: parseFloat(nextLevel.multiplier),
            badgeColor: currentLevelData.badge_color,
            nextBadgeColor: nextLevel.badge_color
        } : {
            current: p.current_level,
            next: null,
            currentPoints: lifetime,
            percentage: 100,
            pointsNeeded: 0,
            badgeColor: currentLevelData.badge_color
        };

        // Update last_briefing_at
        await pool.query('UPDATE painters SET last_briefing_at = NOW() WHERE id = ?', [painterId]);

        res.json({
            success: true,
            briefing: {
                earned: {
                    pointsSinceLastVisit: earnedSinceLastVisit,
                    estimateUpdates,
                    withdrawalUpdates
                },
                dailyBonus,
                progress: {
                    streak: p.current_streak || 0,
                    longestStreak: p.longest_streak || 0,
                    level: levelProgress,
                    multiplier: parseFloat(currentLevelData.multiplier)
                }
            }
        });
    } catch (error) {
        console.error('[Briefing] Error:', error);
        res.status(500).json({ success: false, message: 'Failed to load briefing' });
    }
});
```

- [ ] **Step 2: Modify `GET /me/dashboard` to include level + streak data**

In the existing `GET /me/dashboard` endpoint (line 565), add level and streak data to the response.

In the `Promise.all` array at line 567, add one more query:

```javascript
pool.query('SELECT current_level, current_streak, longest_streak FROM painters WHERE id = ?', [req.painter.id])
```

Then in the response object (line 593), add to the `dashboard` object:

```javascript
level: painterLevel[0]?.current_level || 'bronze',
streak: painterLevel[0]?.current_streak || 0,
longestStreak: painterLevel[0]?.longest_streak || 0,
```

(Where `painterLevel` is the destructured result from the new query.)

- [ ] **Step 3: Add `GET /me/checkin-history` endpoint for streak calendar**

Add right after the briefing endpoint:

```javascript
// ═══════════════════════════════════════════
// CHECK-IN HISTORY (for streak calendar)
// ═══════════════════════════════════════════

router.get('/me/checkin-history', requirePainterAuth, async (req, res) => {
    try {
        const month = req.query.month; // format: YYYY-MM
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, message: 'month param required (YYYY-MM)' });
        }

        const [checkins] = await pool.query(
            `SELECT checkin_date, streak_count, bonus_awarded
             FROM painter_daily_checkins
             WHERE painter_id = ? AND checkin_date LIKE ?
             ORDER BY checkin_date ASC`,
            [req.painter.id, `${month}%`]
        );

        res.json({
            success: true,
            checkins: checkins.map(c => ({
                date: c.checkin_date,
                streak: c.streak_count,
                bonus: parseFloat(c.bonus_awarded)
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load check-in history' });
    }
});
```

- [ ] **Step 4: Add daily bonus cap enforcement to `processInvoice()` in points engine**

In `services/painter-points-engine.js`, in `processInvoice()`, add daily bonus product logic AFTER the regular/annual point calculation loop (after line 177) and BEFORE the `addPointsWithMultiplier()` calls:

```javascript
    // Daily bonus product multiplier (capped per day)
    let dailyBonusPoints = 0;
    try {
        const [bonusCfg] = await pool.query(
            "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('painter_daily_bonus_product_id', 'painter_daily_bonus_multiplier', 'painter_daily_bonus_cap')"
        );
        const bcfg = {};
        bonusCfg.forEach(c => { bcfg[c.config_key] = c.config_value; });
        const bonusProductId = bcfg.painter_daily_bonus_product_id;
        const bonusMultiplier = parseInt(bcfg.painter_daily_bonus_multiplier) || 2;
        const bonusCap = parseInt(bcfg.painter_daily_bonus_cap) || 500;

        if (bonusProductId) {
            // Check if any line items match the daily bonus product
            for (const item of lineItems) {
                // Match by item_id or by product mapping
                const [mapped] = await pool.query(
                    'SELECT product_id FROM zoho_items_map WHERE zoho_item_id = ? AND product_id = ?',
                    [item.item_id, bonusProductId]
                );
                if (mapped.length) {
                    const baseRegular = totalRegularPoints; // points from this product
                    const bonusExtra = Math.round(baseRegular * (bonusMultiplier - 1) * 100) / 100;

                    // Check how much bonus already earned today
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const [todayBonus] = await pool.query(
                        `SELECT COALESCE(SUM(amount), 0) as total FROM painter_point_transactions
                         WHERE painter_id = ? AND source = 'daily_bonus' AND DATE(created_at) = ?`,
                        [painterId, todayStr]
                    );
                    const alreadyEarned = parseFloat(todayBonus[0].total);
                    const remaining = Math.max(0, bonusCap - alreadyEarned);
                    dailyBonusPoints = Math.min(bonusExtra, remaining);
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Points] Daily bonus check failed:', e.message);
    }
```

Then AFTER the regular/annual `addPointsWithMultiplier()` calls, add:

```javascript
    // Award daily bonus points if applicable
    if (dailyBonusPoints > 0) {
        await addPoints(painterId, 'regular', dailyBonusPoints, 'daily_bonus',
            invoice.invoice_id, 'invoice', `Daily bonus product multiplier`, createdBy);
    }
```

And include `dailyBonusPoints` in the return object.

- [ ] **Step 5: Commit**

```bash
git add routes/painters.js services/painter-points-engine.js
git commit -m "feat(painter): add checkin-history endpoint + daily bonus cap enforcement"
```

---

## Chunk 4: Card Generator Level Badge

### Task 7: Add Level Badge to Visiting Card and ID Card

**Files:**
- Modify: `services/painter-card-generator.js`

- [ ] **Step 1: Update `generateCard()` signature and add level badge SVG**

In `generateCard()` (line 71), the function receives `painter` object. The caller already passes the full painter row. Add `current_level` to destructuring on line 72:

```javascript
const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level } = painter;
```

Add a level badge helper function near the top (after `locationIcon` around line 35):

```javascript
function levelBadge(x, y, level) {
    const LEVEL_COLORS = {
        bronze: '#CD7F32', silver: '#9CA3AF', gold: '#D4A24E', diamond: '#3B82F6'
    };
    const color = LEVEL_COLORS[level] || LEVEL_COLORS.bronze;
    const label = (level || 'bronze').charAt(0).toUpperCase() + (level || 'bronze').slice(1);
    return `
        <rect x="${x}" y="${y}" width="140" height="36" rx="18" fill="${color}" opacity="0.15"/>
        <circle cx="${x + 20}" cy="${y + 18}" r="8" fill="${color}"/>
        <text x="${x + 36}" y="${y + 24}" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="${color}">${label}</text>
    `;
}
```

- [ ] **Step 2: Add level badge to visiting card SVG**

In the visiting card SVG template (inside `generateCard()`, around line 135 after the "QC PAINTERS PROGRAM" text), add the level badge:

```javascript
        <!-- Level badge -->
        ${levelBadge(CARD_W - 200, 148, current_level)}
```

- [ ] **Step 3: Add level badge to ID card SVG**

In `generateIdCard()` (line 195), add `current_level` to destructuring:

```javascript
const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level } = painter;
```

Add the badge in the ID card SVG, below the "PAINTER IDENTITY CARD" text (around line 254):

```javascript
        <!-- Level badge -->
        ${levelBadge((ID_W - 140) / 2, 160, current_level)}
```

- [ ] **Step 4: Verify card cache clearing on level-up**

Already handled: `checkLevelUp()` in `painter-points-engine.js` (Task 2) already clears `card_generated_at` and `id_card_generated_at` when level changes. No additional changes needed here.

- [ ] **Step 5: Commit**

```bash
git add services/painter-card-generator.js services/painter-points-engine.js
git commit -m "feat(painter): add level badge to visiting card and ID card"
```

---

## Chunk 5: Dashboard Frontend Redesign

### Task 8: Redesign Dashboard HTML — Briefing Card + Streak + Levels

**Files:**
- Modify: `public/painter-dashboard.html`

- [ ] **Step 1: Add new CSS styles**

Add to the `<style>` block (before `</style>`, around line 123):

```css
/* Streak flame colors */
.streak-flame { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.streak-flame svg { transition: transform 0.3s; }
.streak-flame:hover svg { transform: scale(1.15); }
.streak-1-6 { color: #f97316; }    /* orange */
.streak-7-13 { color: #ef4444; }   /* red */
.streak-14-29 { color: #3b82f6; }  /* blue */
.streak-30 { color: #a855f7; }     /* purple */

/* Briefing card — gradient border with border-radius */
.briefing-card {
    background: linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #1B5E3B, #D4A24E) border-box;
    border: 2px solid transparent;
    border-radius: 16px;
    padding: 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 4px 16px rgba(27,94,59,0.08);
    position: relative;
    overflow: hidden;
}
.briefing-divider { height: 1px; background: linear-gradient(90deg, transparent, #e5e7eb, transparent); margin: 12px 0; }

/* Level badge pill */
.level-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
.level-pill .dot { width: 8px; height: 8px; border-radius: 50%; }

/* Level progress panel */
.level-panel { display: none; background: #fff; border-radius: 16px; padding: 1.25rem; border: 1px solid #e8ecf1; margin-bottom: 1rem; }
.level-panel.show { display: block; }
.level-tier { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.level-tier .tier-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.level-tier.current { background: #f0fdf4; border-radius: 8px; padding: 8px 12px; margin: 0 -12px; }

/* Streak calendar bottom sheet */
.streak-sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1100; display: flex; align-items: flex-end; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.25s; }
.streak-sheet-overlay.show { opacity: 1; pointer-events: auto; }
.streak-sheet { background: #fff; border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; max-height: 70vh; overflow-y: auto; padding: 20px; transform: translateY(100%); transition: transform 0.35s cubic-bezier(.4,0,.2,1); }
.streak-sheet-overlay.show .streak-sheet { transform: translateY(0); }
.streak-calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
.streak-calendar .day { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8125rem; margin: 0 auto; }
.streak-calendar .day.checked { background: #d1fae5; color: #065f46; font-weight: 600; }
.streak-calendar .day.today { border: 2px solid #1B5E3B; }

/* Level-up celebration */
.celebration-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
.celebration-card { background: #fff; border-radius: 24px; padding: 2rem; text-align: center; max-width: 340px; width: 90%; }

/* Progress bar */
.progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
.progress-bar-fill { height: 100%; border-radius: 4px; transition: width 1s ease; }

/* Animated counter */
@keyframes countUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.count-up { animation: countUp 0.5s ease forwards; }
```

- [ ] **Step 2: Replace header section with greeting + level badge + streak flame**

Replace the header inner content (lines 127-170) with:

```html
    <!-- Header -->
    <div class="header">
        <div class="max-w-lg mx-auto px-4 py-3">
            <div class="flex items-center justify-between">
                <!-- Left: Logo + Greeting + Level Badge -->
                <div class="flex items-center gap-2.5">
                    <img id="headerLogo" style="width:48px;height:48px;border-radius:10px;object-fit:contain;display:none;box-shadow:0 2px 6px rgba(0,0,0,0.15)" alt="QC">
                    <div>
                        <p class="text-sm opacity-80" id="greetingText">Good Morning,</p>
                        <div class="flex items-center gap-2">
                            <h1 class="text-xl font-bold" id="painterName">Painter</h1>
                            <span id="streakFlame" class="streak-flame" onclick="showStreakSheet()" style="display:none" title="Tap for streak details"></span>
                        </div>
                        <span id="levelBadge" class="level-pill" onclick="toggleLevelPanel()" style="display:none"></span>
                    </div>
                </div>
                <!-- Right: Lang + Bell + Profile -->
                <div class="flex items-center gap-2">
                    <button id="langToggle" onclick="painterI18n.toggleLanguage()" class="text-sm font-semibold bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 transition-colors backdrop-blur-sm">
                        EN
                    </button>
                    <button onclick="showNotificationPanel()" class="relative p-1 hover:bg-white/20 rounded-lg transition-colors">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        <span id="notifBadge" class="notif-badge hidden">0</span>
                    </button>
                    <div class="relative">
                        <button onclick="toggleProfileDropdown()" id="headerAvatarBtn" style="width:42px;height:42px;border-radius:50%;background:#D4A24E;border:2px solid white;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer">
                            <span id="headerInitial" style="color:white;font-size:17px;font-weight:700">P</span>
                        </button>
                        <div id="profileDropdown" class="profile-dropdown">
                            <a href="/painter-profile.html">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                My Profile
                            </a>
                            <div class="divider"></div>
                            <button onclick="logout()">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                                <span style="color:#ef4444">Logout</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
```

- [ ] **Step 3: Add briefing card before balance cards**

Insert after `<div class="max-w-lg mx-auto px-4 -mt-2 pb-20">` (line 172) and BEFORE the balance cards grid:

```html
        <!-- Morning Briefing Card -->
        <div id="briefingCard" class="briefing-card" style="display:none">
            <!-- What you earned -->
            <div id="briefingEarned">
                <div class="flex items-center gap-2 mb-1">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                    <span class="text-sm font-semibold text-gray-600">Since your last visit</span>
                </div>
                <div class="flex items-baseline gap-2">
                    <span id="briefingPointsEarned" class="text-2xl font-bold text-emerald-700 count-up">0</span>
                    <span class="text-sm text-gray-400">points earned</span>
                </div>
                <div id="briefingUpdates" class="mt-1 space-y-1"></div>
            </div>

            <div class="briefing-divider"></div>

            <!-- Today's opportunity -->
            <div id="briefingBonus" style="display:none">
                <div class="flex items-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4A24E" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span class="text-sm font-semibold text-gray-600">Today's Opportunity</span>
                    <span id="bonusCountdown" class="text-xs text-gray-400 ml-auto"></span>
                </div>
                <div class="flex items-center gap-3 p-2 rounded-xl" style="background:#fefce8">
                    <img id="bonusProductImg" class="w-12 h-12 rounded-lg object-contain bg-white" src="" alt="" onerror="this.style.display='none'">
                    <div class="flex-1 min-w-0">
                        <p id="bonusProductName" class="text-sm font-bold text-gray-800 truncate"></p>
                        <p id="bonusProductBrand" class="text-xs text-gray-400"></p>
                    </div>
                    <span id="bonusMultiplierTag" class="offer-tag offer-tag-multiplier text-sm"></span>
                </div>
                <p class="text-xs text-gray-400 mt-1">Max <span id="bonusCap">500</span> bonus points per day</p>
            </div>

            <div id="briefingBonusDivider" class="briefing-divider" style="display:none"></div>

            <!-- Your progress -->
            <div>
                <div class="flex items-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span class="text-sm font-semibold text-gray-600">Your Progress</span>
                </div>
                <div id="briefingLevelProgress">
                    <div class="flex items-center justify-between mb-1">
                        <span id="progressLabel" class="text-xs font-medium text-gray-500"></span>
                        <span id="progressPct" class="text-xs font-bold text-emerald-700"></span>
                    </div>
                    <div class="progress-bar">
                        <div id="progressBarFill" class="progress-bar-fill" style="width:0%;background:linear-gradient(90deg,#1B5E3B,#D4A24E)"></div>
                    </div>
                    <p id="progressNext" class="text-xs text-gray-400 mt-1"></p>
                </div>
            </div>
        </div>

        <!-- Level Progress Panel (shown on badge tap) -->
        <div id="levelPanel" class="level-panel"></div>
```

- [ ] **Step 4: Add streak calendar bottom sheet and level-up celebration modal at bottom of body**

Add before `</body>`:

```html
    <!-- Streak Calendar Bottom Sheet -->
    <div id="streakSheetOverlay" class="streak-sheet-overlay" onclick="if(event.target===this)closeStreakSheet()">
        <div class="streak-sheet">
            <div style="width:40px;height:4px;border-radius:2px;background:#d1d5db;margin:0 auto 16px"></div>
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-lg font-bold text-gray-800">Your Streak</h3>
                <div class="text-right">
                    <p id="streakSheetCount" class="text-2xl font-bold text-emerald-700">0</p>
                    <p class="text-xs text-gray-400">current streak</p>
                </div>
            </div>
            <p id="streakSheetBest" class="text-sm text-gray-500 mb-4"></p>
            <div id="streakCalendar" class="streak-calendar"></div>
            <div class="mt-4 p-3 rounded-xl bg-gray-50">
                <p class="text-sm font-semibold text-gray-700 mb-2">Streak Milestones</p>
                <div class="space-y-1 text-xs text-gray-500">
                    <div class="flex justify-between"><span>3 days</span><span class="font-semibold text-emerald-600">+10 pts</span></div>
                    <div class="flex justify-between"><span>7 days</span><span class="font-semibold text-emerald-600">+50 pts</span></div>
                    <div class="flex justify-between"><span>14 days</span><span class="font-semibold text-emerald-600">+150 pts</span></div>
                    <div class="flex justify-between"><span>30 days</span><span class="font-semibold text-emerald-600">+500 pts</span></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Level-Up Celebration -->
    <div id="celebrationOverlay" class="celebration-overlay" style="display:none" onclick="closeCelebration()">
        <div class="celebration-card" onclick="event.stopPropagation()">
            <div style="font-size:3rem;margin-bottom:8px">🎉</div>
            <h2 class="text-xl font-bold text-gray-800 mb-1">Congratulations!</h2>
            <p id="celebrationMsg" class="text-gray-600 mb-3"></p>
            <div id="celebrationPerks" class="text-left bg-green-50 rounded-xl p-3 mb-4 text-sm"></div>
            <button onclick="shareLevelUp()" class="w-full py-2.5 rounded-xl text-white font-semibold" style="background:linear-gradient(135deg,#1B5E3B,#D4A24E)">
                Share on WhatsApp
            </button>
            <button onclick="closeCelebration()" class="w-full py-2 mt-2 text-sm text-gray-400">Maybe later</button>
        </div>
    </div>
```

- [ ] **Step 5: Add JavaScript for briefing, streak, and level features**

Add to the `<script>` block in the dashboard (inside the existing `DOMContentLoaded` or `init` flow). This should go in the main `<script>` section:

```javascript
// ═══════════════════════════════════════════
// RETENTION: STREAK, BRIEFING, LEVELS
// ═══════════════════════════════════════════

let briefingData = null;

// Record daily streak (once per session)
async function recordDailyStreak() {
    if (sessionStorage.getItem('streak_recorded')) return;
    try {
        const resp = await fetch('/api/painters/me/daily-streak', {
            method: 'PUT',
            headers: { ...painterHeaders(), 'Content-Type': 'application/json' }
        });
        const data = await resp.json();
        if (data.success) {
            sessionStorage.setItem('streak_recorded', '1');
            updateStreakUI(data.streak, data.longestStreak);
            if (data.levelUp) showLevelUpCelebration(data.levelUp);
            if (data.milestoneHit && data.bonusAwarded) {
                showToast(`🔥 ${data.milestoneHit}-day streak! +${data.bonusAwarded} bonus points!`);
            }
        }
    } catch (e) { console.error('Streak error:', e); }
}

// Load briefing data
async function loadBriefing() {
    try {
        const resp = await fetch('/api/painters/me/briefing', { headers: painterHeaders() });
        const data = await resp.json();
        if (data.success) {
            briefingData = data.briefing;
            renderBriefingCard(data.briefing);
        }
    } catch (e) { console.error('Briefing error:', e); }
}

function renderBriefingCard(b) {
    const card = document.getElementById('briefingCard');
    card.style.display = '';

    // Earned section
    const earnedEl = document.getElementById('briefingPointsEarned');
    animateCounter(earnedEl, b.earned.pointsSinceLastVisit);

    // Updates
    const updatesEl = document.getElementById('briefingUpdates');
    updatesEl.innerHTML = '';
    (b.earned.estimateUpdates || []).slice(0, 3).forEach(e => {
        updatesEl.innerHTML += `<p class="text-xs text-gray-500">📋 Estimate #${e.estimate_number} → <span class="font-medium">${formatStatus(e.status)}</span></p>`;
    });
    (b.earned.withdrawalUpdates || []).slice(0, 2).forEach(w => {
        updatesEl.innerHTML += `<p class="text-xs text-gray-500">💰 Withdrawal ₹${w.amount} → <span class="font-medium">${w.status}</span></p>`;
    });

    // Daily bonus
    if (b.dailyBonus) {
        document.getElementById('briefingBonus').style.display = '';
        document.getElementById('briefingBonusDivider').style.display = '';
        const prod = b.dailyBonus.product;
        document.getElementById('bonusProductName').textContent = prod.name;
        document.getElementById('bonusProductBrand').textContent = prod.brand || '';
        if (prod.image_url) {
            document.getElementById('bonusProductImg').src = prod.image_url;
            document.getElementById('bonusProductImg').style.display = '';
        }
        document.getElementById('bonusMultiplierTag').textContent = `${b.dailyBonus.multiplier}x Points`;
        document.getElementById('bonusCap').textContent = b.dailyBonus.cap;
        startBonusCountdown(b.dailyBonus.hoursLeft);
    }

    // Progress
    const lp = b.progress.level;
    if (lp.next) {
        document.getElementById('progressLabel').textContent = `${capitalize(lp.current)} → ${capitalize(lp.next)}`;
        document.getElementById('progressPct').textContent = `${lp.percentage}%`;
        setTimeout(() => {
            document.getElementById('progressBarFill').style.width = `${lp.percentage}%`;
        }, 300);
        document.getElementById('progressNext').textContent = `${Math.round(lp.pointsNeeded).toLocaleString()} pts to unlock ${lp.nextMultiplier}x multiplier!`;
    } else {
        document.getElementById('progressLabel').textContent = `${capitalize(lp.current)} — Max Level!`;
        document.getElementById('progressPct').textContent = '100%';
        document.getElementById('progressBarFill').style.width = '100%';
        document.getElementById('progressNext').textContent = 'You are at the highest level!';
    }
}

function updateStreakUI(streak, longestStreak) {
    const flame = document.getElementById('streakFlame');
    if (streak > 0) {
        let colorClass = 'streak-1-6';
        if (streak >= 30) colorClass = 'streak-30';
        else if (streak >= 14) colorClass = 'streak-14-29';
        else if (streak >= 7) colorClass = 'streak-7-13';

        flame.className = `streak-flame ${colorClass}`;
        flame.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 23c-3.6 0-7-2.5-7-7 0-3.1 2-5.7 3.2-7.2.4-.5 1.2-.3 1.3.3.2 1 .7 2.3 1.5 3.2.1-.3.1-.7.1-1.1 0-1.6-.3-3.4-.8-4.8-.2-.5.2-1 .7-.9C14.3 6.4 19 9.5 19 16c0 4.5-3.4 7-7 7z"/>
            </svg>
            <span class="text-sm font-bold">${streak}</span>`;
        flame.style.display = 'inline-flex';
    }
    // Store for streak sheet
    flame.dataset.streak = streak;
    flame.dataset.longest = longestStreak;
}

function updateLevelBadge(level) {
    const COLORS = { bronze: '#CD7F32', silver: '#9CA3AF', gold: '#D4A24E', diamond: '#3B82F6' };
    const badge = document.getElementById('levelBadge');
    const color = COLORS[level] || COLORS.bronze;
    badge.innerHTML = `<span class="dot" style="background:${color}"></span>${capitalize(level)}`;
    badge.style.background = `${color}15`;
    badge.style.color = color;
    badge.style.display = 'inline-flex';
}

// Time-of-day greeting
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning,';
    if (h < 17) return 'Good Afternoon,';
    return 'Good Evening,';
}

// Animated number counter
function animateCounter(el, target) {
    target = Math.round(target);
    if (target === 0) { el.textContent = '0'; return; }
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 30));
    const interval = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current.toLocaleString();
        if (current >= target) clearInterval(interval);
    }, 30);
}

// Countdown timer for bonus
function startBonusCountdown(hoursLeft) {
    const el = document.getElementById('bonusCountdown');
    let remaining = hoursLeft * 3600;
    function update() {
        if (remaining <= 0) { el.textContent = 'Expired'; return; }
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        el.textContent = `${h}h ${m}m left`;
        remaining--;
    }
    update();
    setInterval(update, 60000); // Update every minute
}

// Streak calendar bottom sheet
function showStreakSheet() {
    const overlay = document.getElementById('streakSheetOverlay');
    const flame = document.getElementById('streakFlame');
    document.getElementById('streakSheetCount').textContent = flame.dataset.streak || '0';
    document.getElementById('streakSheetBest').textContent = `Personal best: ${flame.dataset.longest || '0'} days`;

    // Build calendar for current month
    const cal = document.getElementById('streakCalendar');
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();

    // Load actual check-in dates from painter_daily_checkins
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const today = now.getDate();

    // Render header
    cal.innerHTML = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
        `<div class="text-xs font-semibold text-gray-400 py-1">${d}</div>`
    ).join('');
    for (let i = 0; i < firstDay; i++) cal.innerHTML += '<div></div>';

    // Fetch real check-in data
    fetch(`/api/painters/me/checkin-history?month=${monthStr}`, { headers: painterHeaders() })
        .then(r => r.json())
        .then(data => {
            const checkedDays = new Set();
            if (data.success && data.checkins) {
                data.checkins.forEach(c => {
                    const d = new Date(c.date).getDate();
                    checkedDays.add(d);
                });
            }

            // Clear and re-render with real data
            cal.innerHTML = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
                `<div class="text-xs font-semibold text-gray-400 py-1">${d}</div>`
            ).join('');
            for (let i = 0; i < firstDay; i++) cal.innerHTML += '<div></div>';

            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = d === today;
                const isChecked = checkedDays.has(d);
                const classes = ['day'];
                if (isChecked) classes.push('checked');
                if (isToday) classes.push('today');
                cal.innerHTML += `<div class="${classes.join(' ')}">${d}</div>`;
            }
        })
        .catch(() => {
            // Fallback: approximate from streak count
            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = d === today;
                const isStreakDay = d <= today && d > today - streak;
                const classes = ['day'];
                if (isStreakDay) classes.push('checked');
                if (isToday) classes.push('today');
                cal.innerHTML += `<div class="${classes.join(' ')}">${d}</div>`;
            }
        });

    overlay.classList.add('show');
}

function closeStreakSheet() {
    document.getElementById('streakSheetOverlay').classList.remove('show');
}

// Level panel toggle
function toggleLevelPanel() {
    const panel = document.getElementById('levelPanel');
    if (panel.classList.contains('show')) {
        panel.classList.remove('show');
        return;
    }
    if (!briefingData) return;

    const lp = briefingData.progress.level;
    const LEVELS = [
        { name: 'bronze', label: 'Bronze', color: '#CD7F32', threshold: '0', multiplier: '1x', perks: 'Base rates' },
        { name: 'silver', label: 'Silver', color: '#9CA3AF', threshold: '5,000', multiplier: '1.2x', perks: '1.2x point multiplier' },
        { name: 'gold', label: 'Gold', color: '#D4A24E', threshold: '25,000', multiplier: '1.5x', perks: '1.5x multiplier + priority approval' },
        { name: 'diamond', label: 'Diamond', color: '#3B82F6', threshold: '100,000', multiplier: '2x', perks: '2x multiplier + exclusive offers' }
    ];

    panel.innerHTML = '<h3 class="font-bold text-gray-800 mb-3">Level Tiers</h3>' +
        LEVELS.map(l => `
            <div class="level-tier ${l.name === lp.current ? 'current' : ''}">
                <div class="tier-dot" style="background:${l.color}"></div>
                <div class="flex-1">
                    <p class="text-sm font-semibold" style="color:${l.color}">${l.label} ${l.name === lp.current ? '← You' : ''}</p>
                    <p class="text-xs text-gray-400">${l.threshold} pts — ${l.perks}</p>
                </div>
                <span class="text-sm font-bold" style="color:${l.color}">${l.multiplier}</span>
            </div>
        `).join('');

    panel.classList.add('show');
}

// Level-up celebration
function showLevelUpCelebration(levelUp) {
    const PERKS = {
        silver: ['1.2x multiplier on all earnings', 'Silver badge on your card'],
        gold: ['1.5x multiplier on all earnings', 'Priority estimate approval', 'Gold badge on your card'],
        diamond: ['2x multiplier on all earnings', 'Exclusive offers', 'Featured painter card', 'Diamond badge']
    };

    document.getElementById('celebrationMsg').textContent =
        `You've reached ${capitalize(levelUp.newLevel)} level!`;
    document.getElementById('celebrationPerks').innerHTML =
        `<p class="font-semibold text-green-800 mb-2">Your new perks:</p>` +
        (PERKS[levelUp.newLevel] || []).map(p => `<p class="text-green-700">✓ ${p}</p>`).join('');
    document.getElementById('celebrationOverlay').style.display = 'flex';
}

function closeCelebration() {
    document.getElementById('celebrationOverlay').style.display = 'none';
}

function shareLevelUp() {
    const level = briefingData?.progress?.level?.current || 'silver';
    const text = `I just reached ${capitalize(level)} level on QC Painters! 🎉 Earning ${briefingData?.progress?.multiplier || 1}x points on every purchase. Join me: ${window.location.origin}/painter-register.html`;
    if (navigator.share) {
        navigator.share({ title: 'QC Painters Level Up!', text }).catch(() => {});
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
    closeCelebration();
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function formatStatus(s) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
```

- [ ] **Step 6: Integrate into existing `loadDashboard()` flow**

In the existing `loadDashboard()` function, after it sets `painterName`, add:

```javascript
// Set time-of-day greeting
document.getElementById('greetingText').textContent = getGreeting();

// Update level badge
if (data.dashboard.level) updateLevelBadge(data.dashboard.level);
if (data.dashboard.streak > 0) updateStreakUI(data.dashboard.streak, data.dashboard.longestStreak);
```

And at the end of `loadDashboard()` (or in the main init flow), call:

```javascript
// Record streak + load briefing (parallel)
recordDailyStreak();
loadBriefing();
```

- [ ] **Step 7: Test manually in browser**

1. Open painter dashboard
2. Verify briefing card appears with gradient border
3. Verify streak flame appears in header after first load
4. Verify level badge appears (Bronze initially)
5. Tap streak flame → calendar bottom sheet opens
6. Tap level badge → tier panel toggles
7. Check console for any JS errors

- [ ] **Step 8: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat(painter): add briefing card, streak flame, level badges to dashboard"
```

---

## Chunk 6: Admin Visibility + Final Integration

### Task 9: Add Level + Streak to Admin Painters View

**Files:**
- Modify: `public/admin-painters.html` (add level/streak columns to painter list)

- [ ] **Step 1: Find the painter list/table rendering in admin-painters.html**

Locate where painter rows are rendered in the Overview or list tab. Add columns for Level and Streak to the table header and row rendering.

In the table header, add:
```html
<th>Level</th>
<th>Streak</th>
```

In the row rendering function, add cells:
```javascript
const LEVEL_COLORS = { bronze: '#CD7F32', silver: '#9CA3AF', gold: '#D4A24E', diamond: '#3B82F6' };
const level = painter.current_level || 'bronze';
const levelColor = LEVEL_COLORS[level];
// Add to row HTML:
`<td><span style="color:${levelColor};font-weight:600">${level.charAt(0).toUpperCase() + level.slice(1)}</span></td>`
`<td>${painter.current_streak || 0} 🔥</td>`
```

- [ ] **Step 2: Add level/streak to admin painter detail view**

In the painter detail modal/tab, add level and streak info.

- [ ] **Step 3: Modify backend admin painter list endpoint to include new columns**

Check the admin `GET /` or `GET /list` endpoint in `routes/painters.js` that returns painter data for admin. Ensure it selects `current_level`, `current_streak`, `longest_streak` columns. These are already on the `painters` table, so if the query uses `SELECT *`, they'll be included automatically. If it selects specific columns, add them.

- [ ] **Step 4: Commit**

```bash
git add public/admin-painters.html routes/painters.js
git commit -m "feat(painter): show level and streak in admin painters view"
```

---

### Task 10: Android Notification Routing (Kotlin)

**Files:**
- Modify: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\app\src\main\java\com\qcpaintshop\act\fcm\QCFirebaseMessagingService.kt`

**Note:** This is in the Android repo. Skip if not building APK in this session.

- [ ] **Step 1: Add routing for new notification types**

In the painter `when` block in `QCFirebaseMessagingService.kt`, add explicit routing:

```kotlin
"streak_milestone" -> "/painter-dashboard.html"
"streak_at_risk" -> "/painter-dashboard.html"
"level_up" -> "/painter-dashboard.html"
"daily_bonus" -> "/painter-dashboard.html"
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "feat(painter): route retention notifications to painter dashboard in Android"
```

---

### Task 11: Server Startup Verification

- [ ] **Step 1: Verify full server starts without errors**

Run: `node server.js` (or `npm start`)
Expected: Server starts, painter scheduler logs show all 7 cron jobs registered.

- [ ] **Step 2: Test endpoints manually**

```bash
# Test streak (needs valid painter token)
curl -X PUT http://localhost:3000/api/painters/me/daily-streak -H "X-Painter-Token: <token>"

# Test briefing
curl http://localhost:3000/api/painters/me/briefing -H "X-Painter-Token: <token>"
```

- [ ] **Step 3: Final commit with all remaining changes**

```bash
git add .
git commit -m "feat(painter): complete painter retention system — levels, streaks, briefing card"
```

---

## Summary of Changes

| Component | What Changed |
|-----------|-------------|
| **Migration** | 2 new tables, 5 new columns, ENUM expansion, 4 config keys |
| **Points Engine** | `getLevelMultiplier()`, `addPointsWithMultiplier()`, `checkLevelUp()` |
| **Scheduler** | 4 new cron jobs: midnight reset, 00:05 rotation, 7AM push, 8PM reminder |
| **Notifications** | 4 templated notification types with English + Tamil |
| **Card Generator** | Level badge SVG on visiting + ID cards |
| **Routes** | `PUT /me/daily-streak`, `GET /me/briefing`, dashboard enriched |
| **Dashboard UI** | Briefing card, streak flame, level badge, celebrations, calendar sheet |
| **Admin** | Level + streak columns visible in painter list |
