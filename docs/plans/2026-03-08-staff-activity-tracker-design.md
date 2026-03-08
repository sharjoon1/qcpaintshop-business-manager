# Staff Activity Tracker - Design Document

**Date:** 2026-03-08
**Status:** Approved

## Goal

Real-time activity tracking for staff from clock-in to clock-out. Staff must select what they're currently doing via activity buttons on the dashboard. Activities are timed, tracked, and visible to admins in real-time. Idle staff (15+ min) receive FCM push alerts. Activity completions auto-mark relevant daily tasks.

## Architecture

Server-driven approach. Staff starts/stops activities via API calls. Server stores sessions in DB with timestamps. A 60s cron job detects idle staff and sends FCM alerts. Socket.io broadcasts activity changes to admin monitor in real-time. No Android native changes needed.

## Activity Types

| Type | Label | Navigates To | On Start | On End |
|------|-------|-------------|----------|--------|
| marketing | Marketing / Lead Work | /staff/leads.html | - | Track leads_added, calls_made |
| outstanding_followup | Outstanding Follow-up | /staff/collections.html | - | Track amount_collected |
| material_arrangement | Material Arrangement | /staff/products.html | - | - |
| material_receiving | Material Receiving & Billing | /staff/daily-tasks.html | - | - |
| attending_customer | Attending Customer | stays on dashboard | Modal: customer note (required) | Optional outcome note |
| shop_maintenance | Shop Maintenance | stays on dashboard | - | Photo proof (required) |

## Database Schema

### Table: `staff_activity_sessions`

| Column | Type | Description |
|--------|------|-------------|
| id | INT PK AUTO_INCREMENT | |
| user_id | INT NOT NULL | FK to users |
| branch_id | INT NOT NULL | Branch |
| activity_type | ENUM('marketing','outstanding_followup','material_arrangement','material_receiving','attending_customer','shop_maintenance') | |
| started_at | DATETIME NOT NULL | When activity started |
| ended_at | DATETIME NULL | NULL = currently active |
| duration_minutes | INT NULL | Calculated on end |
| auto_ended | TINYINT(1) DEFAULT 0 | Was it auto-ended by next activity, clock-out, break, etc. |
| metadata | JSON NULL | Extra data: leads_added, calls_made, customer_note, outcome_note, photos, amount_collected |
| created_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |

Indexes: `(user_id, started_at)`, `(user_id, ended_at)`, `(branch_id, started_at)`

### Table: `staff_idle_alerts`

| Column | Type | Description |
|--------|------|-------------|
| id | INT PK AUTO_INCREMENT | |
| user_id | INT NOT NULL | FK to users |
| idle_started_at | DATETIME NOT NULL | When last activity ended |
| alert_sent_at | DATETIME NOT NULL | When FCM was sent |
| responded_at | DATETIME NULL | When staff started next activity |
| idle_minutes | INT NULL | Total idle time |
| created_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |

Index: `(user_id, alert_sent_at)`

## API Endpoints

All under `/api/activity-tracker/`, authenticated via staff auth token.

| Method | Path | Description |
|--------|------|-------------|
| POST | /start | Start activity. Body: `{ type, metadata? }`. Auto-ends previous session. Returns `{ session, redirect? }` |
| POST | /stop | Stop current activity. Body: `{ metadata?, photos? }`. For shop_maintenance, photo required. |
| GET | /current | Get staff's active session (or null) |
| GET | /today | Today's activity timeline for the logged-in staff |
| GET | /admin/live | All currently active staff sessions with user info (admin only) |
| GET | /admin/staff/:id/timeline | Specific staff member's day timeline (admin only) |
| GET | /admin/summary | Day summary: time per activity per staff (admin only) |

### POST /start Flow

1. Validate activity_type is valid ENUM value
2. If attending_customer, require metadata.customer_note
3. Find active session for user (ended_at IS NULL)
4. If exists, auto-end it: set ended_at = NOW(), calculate duration_minutes, auto_ended = 1
5. Insert new session with started_at = NOW()
6. Log to staff_activity_feed
7. Emit Socket.io event: `activity_tracker_update` to admin room
8. Clear any pending idle alert (set responded_at = NOW())
9. Return session + redirect path

### POST /stop Flow

1. Find active session for user
2. If shop_maintenance, require photos in body (at least 1)
3. Set ended_at = NOW(), calculate duration_minutes
4. Merge metadata (customer outcome_note, photos, etc.)
5. Auto-complete matching daily task if applicable
6. Log to staff_activity_feed
7. Emit Socket.io event

## Activity Selector UI (Dashboard)

After clock-in, prominently shows "What are you going to do now?" with 6 activity buttons in a 2x3 grid. Dark green theme matching staff branding (#1B5E3B).

When activity is active, card transforms to show: activity name, elapsed timer (updating every second via JS), started time, [Switch Activity] and [Stop] buttons.

Below the active card: Today's Timeline showing chronological list of completed and active sessions with duration, metadata summaries.

## Admin Monitoring

### Admin Attendance Page (existing)
- New column "Current Activity" showing activity type + duration badge
- Idle staff shown with amber warning badge

### New Page: admin-activity-monitor.html
- Summary cards: Active count, Idle count, On Break count, per-activity counts
- Staff cards showing: name, branch, current activity, duration, key metrics
- Idle staff highlighted with "Send Reminder" button (manual FCM push)
- Day summary: stacked time breakdown per staff
- Socket.io live updates, 30s auto-refresh fallback
- Permission: `attendance.view` (reuse existing)

## Idle Detection (Server Cron)

Runs every 60s (added to existing attendance cron in server.js):

1. Query clocked-in staff with no active session (ended_at IS NOT NULL on latest, or no sessions at all)
2. Calculate idle_time = NOW() - COALESCE(last_session.ended_at, attendance.clock_in)
3. Skip staff on break, outside work, or prayer
4. If idle >= 15 min AND no alert in last 30 min:
   - FCM to staff: "What are you doing? Please select your current activity." (normal priority, qc_notifications channel)
   - Insert staff_idle_alerts row
   - Emit socket event for admin monitor
5. If idle >= 30 min:
   - FCM to all admins: "Staff Idle Alert: {name} idle for {minutes}m since {time}"

## Auto-End Triggers

Active session auto-ends (auto_ended = 1) when:
- Staff starts a new activity (switch)
- Staff clocks out
- Break starts
- Outside work starts
- Prayer starts
- Max-hours auto-clockout
- Geo auto-clockout
- Location-off auto-clockout

After break/prayer/outside ends: activity selector shows again "You're back! What are you going to do now?"

## Daily Task Auto-Completion

| Activity | Condition | Auto-marks Template |
|----------|-----------|-------------------|
| marketing + calls_made > 0 | Session ended | "Calls to Painters" (template_id lookup by section='marketing') |
| outstanding_followup + amount_collected > 0 | Session ended | "Outstanding Followed" (section='outstanding') |
| material_receiving | Session completed | "Material Received" (section='material') |
| attending_customer | Session completed | "Customer Attended" (section='sales') |
| shop_maintenance + photo uploaded | Session ended with photo | "Shop Clean + Racks Filled" (section='morning') |

Auto-completion inserts into daily_task_responses with answer='yes' and metadata from session. Does NOT overwrite existing manual responses.

## Socket.io Events

| Event | Payload | Sent To |
|-------|---------|---------|
| activity_tracker_update | { userId, type, action: 'start'/'stop', session } | admin room |
| activity_tracker_idle | { userId, idleMinutes } | admin room |

## File Structure

- `routes/activity-tracker.js` — All endpoints
- `services/activity-tracker-service.js` — Business logic, idle detection, daily task sync
- `public/staff/dashboard.html` — Activity selector card + timeline (modify existing)
- `public/admin-activity-monitor.html` — New admin page
- `public/admin-attendance.html` — Add activity column (modify existing)
- `migrations/migrate-activity-tracker.js` — Create tables
