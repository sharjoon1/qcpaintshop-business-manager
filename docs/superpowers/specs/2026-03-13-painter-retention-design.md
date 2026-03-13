# Painter Retention System — Daily Briefing + Streak Engine + Levels

**Date:** 2026-03-13
**Status:** Approved
**Goal:** Make painters open the QC Painters app daily through habit-forming mechanics — personal progression, streak rewards, and a dynamic morning briefing.
**Context:** ~20 painters today, target 500. Aggressive growth budget (bonus points = real withdrawal money). Features must feel rewarding solo and scale naturally.

---

## 1. Painter Levels System

4 tiers based on lifetime points earned (`total_earned_regular + total_earned_annual` from `painters` table):

| Level | Threshold | Badge Color | Multiplier | Perks |
|-------|-----------|-------------|------------|-------|
| Bronze | 0 pts (default) | `#CD7F32` copper | 1.0x | Base rates |
| Silver | 5,000 lifetime | `#9CA3AF` gray | 1.2x | 1.2x point multiplier on all earnings |
| Gold | 25,000 lifetime | `#D4A24E` gold | 1.5x | 1.5x multiplier + priority estimate approval |
| Diamond | 100,000 lifetime | `#3B82F6` blue | 2.0x | 2x multiplier + exclusive offers + featured card |

- Level badge shown on dashboard header, visiting card, ID card, profile
- Level-up triggers celebratory push notification + full-screen confetti + share-to-WhatsApp modal
- Multiplier applied via wrapper function `addPointsWithMultiplier()` — only used for invoice processing, attendance, and streak bonuses. Core `addPoints()` is NOT modified (admin adjustments, slabs stay at 1x).
- Admin sees each painter's level in `admin-painters.html`
- Thresholds tuned: ~1,000-2,000 pts/month typical → Silver in 3-5 months, Gold ~1.5 years, Diamond aspirational

## 2. Daily Streak System

- Dashboard load auto-records a daily check-in via `PUT /me/daily-streak` (idempotent — PUT not POST). Called once per session using `sessionStorage` guard to avoid duplicate requests on refresh/navigation.
- Conceptually distinct from physical store attendance (`POST /me/attendance/check-in` which requires GPS). This is "app open" tracking only.
- Consecutive days = streak. Miss a day = reset to 0.
- Bonus points to Regular pool (withdrawable). Level multiplier applies.

| Streak | Bonus Points | Push Notification Copy |
|--------|-------------|----------------------|
| 3 days | 10 pts | "3-day streak! Keep going!" |
| 7 days | 50 pts | "1 week streak! You're on fire!" |
| 14 days | 150 pts | "2 week warrior! 150 bonus points!" |
| 30 days | 500 pts | "30-day legend! 500 bonus points!" |
| 30+ | 500 pts every 30 days | Repeating monthly reward |

- "Streak at risk!" push at 8 PM IST if painter hasn't opened today (only if streak > 0)
- Streak reset at midnight IST for painters whose `last_checkin_date` < yesterday
- Streak flame icon on dashboard, colored by length: 1-6 orange, 7-13 red, 14-29 blue, 30+ purple with sparkle
- Tapping flame opens streak calendar bottom sheet (green dots for checked-in days)
- `longest_streak` tracked — shown on profile page ("Personal best: 45 days") and in streak calendar bottom sheet

## 3. Morning Briefing Card

Dynamic card at top of dashboard, replaces static balance cards row. Three sections in one card:

### "What you earned"
- Points earned since last visit (animated green counter). Anchored to `last_briefing_at` TIMESTAMP column (not DATE) for accuracy across multiple daily visits.
- Pending estimate status changes ("Estimate #45 approved!")
- Withdrawal status updates

### "Today's opportunity"
- Daily bonus product with 2x-3x multiplier, rotates at midnight IST
- "Buy today, earn 3x points on Birla Opus Emulsion!"
- Live countdown timer (hours remaining)
- Per-painter daily cap: max 500 bonus points from daily bonus product (prevents windfall on large purchases)
- Falls back to best active special offer if no bonus product configured

### "Your progress"
- Streak flame with count
- Level progress bar: "Silver -> Gold: 64% — 3,200 / 5,000 pts"
- Next milestone preview: "1,800 pts to unlock 1.5x multiplier!"

**Design:** Never shows "nothing happened" — if no earnings/updates, emphasizes opportunity + progress. Green-to-gold gradient border, white bg, rounded-2xl, subtle shadow.

## 4. Data Model

### New table: `painter_daily_checkins`
```sql
CREATE TABLE painter_daily_checkins (
    painter_id      INT NOT NULL,
    checkin_date    DATE NOT NULL,
    streak_count    INT NOT NULL DEFAULT 1,
    bonus_awarded   DECIMAL(10,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (painter_id, checkin_date),
    FOREIGN KEY (painter_id) REFERENCES painters(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### New table: `painter_levels` (config)
```sql
CREATE TABLE painter_levels (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    level_name      VARCHAR(20) NOT NULL UNIQUE,
    min_points      INT NOT NULL,
    multiplier      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    badge_color     VARCHAR(7) NOT NULL,
    sort_order      INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO painter_levels (level_name, min_points, multiplier, badge_color, sort_order) VALUES
('bronze',  0,      1.00, '#CD7F32', 1),
('silver',  5000,   1.20, '#9CA3AF', 2),
('gold',    25000,  1.50, '#D4A24E', 3),
('diamond', 100000, 2.00, '#3B82F6', 4);
```
Note: INT auto-increment PK is consistent with the rest of the schema. `level_name` has UNIQUE constraint. Values must be lowercase.

### Columns added to `painters` table
```sql
ALTER TABLE painters ADD COLUMN current_level VARCHAR(20) DEFAULT 'bronze';
ALTER TABLE painters ADD COLUMN current_streak INT DEFAULT 0;
ALTER TABLE painters ADD COLUMN last_checkin_date DATE NULL;
ALTER TABLE painters ADD COLUMN longest_streak INT DEFAULT 0;
ALTER TABLE painters ADD COLUMN last_briefing_at TIMESTAMP NULL;
```

### ALTER `painter_point_transactions` source ENUM
```sql
ALTER TABLE painter_point_transactions MODIFY source
    ENUM('self_billing','customer_billing','referral','attendance','monthly_slab',
         'quarterly_slab','withdrawal','credit_debit','admin_adjustment',
         'streak_bonus','daily_bonus') NOT NULL;
```

### New `ai_config` keys
```
painter_daily_bonus_product_id    — rotated by scheduler at midnight IST
painter_daily_bonus_multiplier    — 2 or 3 (randomized)
painter_daily_bonus_cap           — 500 (max bonus points per painter per day from daily bonus product)
painter_streak_reminder_enabled   — 1 (toggle for 8PM reminder push)
```

## 5. Backend Changes

### New endpoints in `routes/painters.js`
- `PUT /me/daily-streak` — Idempotent daily check-in. Calculates streak, awards milestone bonuses, checks level-up. Called by dashboard on load (guarded by `sessionStorage` to fire once per session).
- `GET /me/briefing` — Returns earnings since `last_briefing_at`, pending estimate updates, daily bonus product, streak info, level progress. Updates `last_briefing_at` timestamp on each call.

### Modified files
- **`painter-points-engine.js`** — Add `getLevelMultiplier(painterId)` and `addPointsWithMultiplier(painterId, pool, baseAmount, ...)` wrapper. Core `addPoints()` unchanged — admin adjustments and slabs remain at 1x. Wrapper used only in: `processInvoice()`, `awardAttendancePoints()`, streak bonus awards.
- **`painter-scheduler.js`** — 3 new cron jobs (staggered to avoid race):
  - 00:00 IST: Reset streaks for painters whose `last_checkin_date` < yesterday (uses `DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))` for timezone safety)
  - 00:05 IST: Rotate daily bonus product (random active product from `products` table, multiplier 2 or 3)
  - 20:00 IST: Send `streak_at_risk` push to painters with streak > 0 who haven't checked in today
- **`painter-notification-service.js`** — New notification types: `streak_milestone`, `streak_at_risk`, `level_up`, `daily_bonus`
- **`painter-card-generator.js`** — Add level badge (colored SVG circle + text, NO emoji) to visiting card and ID card. Must use SVG `<circle>` + `<text>` elements (Sharp SVG does not render emoji).
- **`QCFirebaseMessagingService.kt`** — Add explicit routing for `streak_milestone`, `streak_at_risk`, `level_up`, `daily_bonus` → `/painter-dashboard.html` in the painter `when` block (don't rely on `else` fallthrough)

### Unchanged
Estimate flow, withdrawal flow, referral system, catalog, profile, attendance, training — all untouched.

## 6. Dashboard UI Changes

### New layout (top to bottom)
1. **Header**: "Good Morning, {name}!" + level badge pill + streak flame
2. **Briefing card**: Earnings + Today's bonus + Progress bar (gradient border)
3. **Balance cards row**: Regular, Annual, Total, Referrals (moved from top)
4. **Quick actions**: Unchanged
5. **Everything else**: Unchanged

### Streak flame
- Flame icon next to greeting, colored by streak: 1-6 orange, 7-13 red, 14-29 blue, 30+ purple sparkle
- Tap opens streak calendar bottom sheet (green dots = checked-in days)

### Level badge
- Pill-shaped: "Silver" with level color dot
- Tap opens level progress panel: all 4 tiers, current position, perks

### Level-up celebration
- Full-screen confetti (reuse attendance confetti)
- Modal: "Congratulations! You've reached Gold!" + perks list + WhatsApp share button

### Briefing card styling
- Green-to-gold gradient border (`#1B5E3B` → `#D4A24E`)
- White bg, rounded-2xl, subtle shadow
- Sections separated by thin divider
- Countdown timer updates live via setInterval

## 7. Notification Strategy

| Type | Trigger | Channel | Time | Frequency Cap |
|------|---------|---------|------|---------------|
| `streak_at_risk` | Hasn't opened today, streak > 0 | FCM push | 8 PM IST | 1/day |
| `streak_milestone` | Hit 3/7/14/30 day streak | FCM + in-app | On check-in | No cap (earned) |
| `level_up` | Lifetime points cross tier | FCM + in-app | On point award | No cap (rare) |
| `daily_bonus` | New bonus product rotated | FCM push | 7 AM IST | 1/day |

### Notification copy (English + Tamil)

**streak_at_risk:**
- EN: "Your {N}-day streak is at risk! Open the app to keep it alive"
- TA: "உங்கள் {N}-நாள் தொடர் ஆபத்தில்! அதை காப்பாற்ற ஆப்பை திறக்கவும்"

**streak_milestone (7-day):**
- EN: "1 week streak! 50 bonus points added to your wallet"
- TA: "1 வார தொடர்! 50 போனஸ் புள்ளிகள் உங்கள் வாலட்டில் சேர்க்கப்பட்டது"

**level_up (Gold):**
- EN: "You've reached Gold level! All earnings now get 1.5x multiplier"
- TA: "நீங்கள் தங்க நிலையை அடைந்தீர்கள்! அனைத்து வருமானமும் 1.5x பெருக்கி பெறும்"

**daily_bonus:**
- EN: "Today's bonus: 3x points on {product}! Offer ends midnight"
- TA: "இன்றைய போனஸ்: {product} மீது 3x புள்ளிகள்! நள்ளிரவில் முடிவடையும்"

**Smart quiet hours:** No push notifications between 10 PM - 7 AM IST.

## 8. Migration Strategy

Single migration file: `migrations/migrate-painter-retention.js`
- Creates `painter_daily_checkins` table
- Creates `painter_levels` table with seed data (4 tiers)
- Adds columns to `painters` table (`current_level`, `current_streak`, `last_checkin_date`, `longest_streak`, `last_briefing_at`)
- Alters `painter_point_transactions.source` ENUM to add `streak_bonus`, `daily_bonus`
- Inserts `ai_config` keys (4 keys)
- Idempotent (checks before creating)

## 9. Files Changed Summary

| File | Change |
|------|--------|
| `migrations/migrate-painter-retention.js` | NEW — migration |
| `routes/painters.js` | ADD `PUT /me/daily-streak`, `GET /me/briefing` endpoints |
| `services/painter-points-engine.js` | ADD level multiplier logic |
| `services/painter-scheduler.js` | ADD 3 cron jobs (bonus rotation, streak reset, streak reminder) |
| `services/painter-notification-service.js` | ADD 4 notification types |
| `services/painter-card-generator.js` | ADD level badge to cards |
| `public/painter-dashboard.html` | REDESIGN top section: briefing card, streak, levels |
| `QCFirebaseMessagingService.kt` | ADD routing for new notification types |
