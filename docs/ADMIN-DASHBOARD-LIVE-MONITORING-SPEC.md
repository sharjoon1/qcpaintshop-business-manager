# Admin Dashboard - Live Monitoring & Automation Tracking

**Date:** 2026-02-24  
**For:** Claude Code (Developer)  
**Component:** Admin Dashboard - Real-time Staff Activity & Automation Status

---

## Business Requirement (Tamil + English)

> **Tamil:** "என்னுடைய ADMIN Dashboard-இல் எத்தனை Automation செட் செய்யப்பட்டுள்ளது, மற்றும் எத்தனை பேர் அவர்களுடைய டாஸ்க் & ஸ்டாக் செக்கிங் வேலை லைவில் உள்ளனர், போன்ற live Updates காட்ட வேண்டும்"

> **English:** "Admin Dashboard should show live updates: how many automations are configured, how many staff are currently working on tasks & stock checks, and similar real-time activity metrics."

---

## Core Principles

### 1. Real-Time Monitoring
- **Live staff activity** (who's working on what, right now)
- **Automation health** (active automations, last run status)
- **System status** (API health, sync status, pending jobs)
- **Performance metrics** (completion rates, response times)

### 2. At-a-Glance Insights
- **Top section:** Critical metrics (staff online, tasks in progress, alerts)
- **Middle section:** Detailed breakdowns (by branch, by type, by status)
- **Bottom section:** Recent activity feed + automation logs

### 3. Action-Oriented
- Click any metric → drill down to details
- Quick actions: Reassign task, pause automation, notify staff
- Export data for analysis

---

## Dashboard Layout

### Top Section: **Live Status Bar**

```
┌─────────────────────────────────────────────────────────────────────┐
│  🟢 ADMIN DASHBOARD - LIVE                      [Last updated: 2s ago] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  👥 STAFF ONLINE          📋 ACTIVE WORK         ⚙️ AUTOMATIONS     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐│
│  │  7/11 Online    │    │  5 Tasks        │    │  8 Active       ││
│  │  🟢 Working: 5  │    │  3 Stock Checks │    │  ✅ Healthy     ││
│  │  🟡 Idle: 2     │    │  2 Overdue      │    │  🔄 Running: 2  ││
│  └─────────────────┘    └─────────────────┘    └─────────────────┘│
│                                                                     │
│  💰 REVENUE TODAY        📦 COLLECTIONS          ⚠️ ALERTS          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐│
│  │  ₹0 (0 inv)     │    │  ₹65.0K         │    │  11 Critical    ││
│  │  ↓ -100% vs     │    │  ₹20.8L overdue │    │  View All →     ││
│  │    yesterday    │    │  384 invoices   │    │                 ││
│  └─────────────────┘    └─────────────────┘    └─────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Auto-refresh every 10 seconds
- Green/Yellow/Red status indicators
- Click any card → detailed view
- Real-time counters (animated when updates)

---

### Main Section: **Staff Activity Monitor (Live)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  👥 STAFF ACTIVITY - REAL-TIME                      [View All Staff] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🟢 ACTIVELY WORKING (5)                                            │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 📦 Manikandan (QC - Main Branch)              ⏱️ Working 2h 15m│ │
│  │ Stock Check: Main Branch - 1,109 items                        │ │
│  │ Progress: ████████░░░░░░░░░░░░░░ 245/1,109 (22%)            │ │
│  │ Last activity: Checking "Asian Paints Tractor Emulsion"      │ │
│  │ 💾 Last saved: 3 minutes ago                                  │ │
│  │                                                                │ │
│  │ [View Details] [Send Message] [Call]                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 📦 Ramana Kishore RK (QC - Thangachimadam)   ⏱️ Working 1h 30m│ │
│  │ Stock Check: Thangachimadam - 737 items                       │ │
│  │ Progress: ████░░░░░░░░░░░░░░░░░░░░ 85/737 (12%)             │ │
│  │ Last activity: Reported discrepancy in "Berger Weathercoat"  │ │
│  │ ⚠️  3 discrepancies found                                     │ │
│  │                                                                │ │
│  │ [View Details] [Review Discrepancies] [Call]                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 📞 Syed Sickandar (QC - Paramakudi)          ⏱️ Working 45m   │ │
│  │ Task: Customer Follow-up - Murugan Construction               │ │
│  │ Status: 🟡 In Progress (called 2 times, no answer)            │ │
│  │ Last activity: Left voicemail                                 │ │
│  │                                                                │ │
│  │ [View Details] [Reassign] [Send Support]                      │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  🟡 IDLE / CLOCKED IN (2)                                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Syed (QC - Main Branch)                      ⏱️ Idle 15m      │ │
│  │ Last activity: Completed daily sales report                   │ │
│  │ Status: 🟡 No active tasks                                    │ │
│  │                                                                │ │
│  │ [Assign Task] [Send Message]                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  🔴 ABSENT / NOT CLOCKED IN (4)                                     │
│                                                                     │
│  • Mohamed Hathin (QC - Rameswaram) - Not clocked in yet          │
│  • Prain Maxwell (QC - Pamban) - Not clocked in yet               │
│  • Mohamed Ribaydeen (QC - Thangachimadam) - Not clocked in yet   │
│  • Abdul Razzak (QC - Paramakudi) - Not clocked in yet            │
│                                                                     │
│  [Send Clock-in Reminder] [View Attendance Report]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Color-coded status: 🟢 Working, 🟡 Idle, 🔴 Absent
- Real-time progress bars (animate on update)
- "Last activity" updates live
- Quick actions: Message, Call, Reassign
- Click staff name → Full activity timeline

---

### Automation Status Panel

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚙️ AUTOMATIONS & SCHEDULED JOBS                   [Configure →]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📊 SUMMARY                                                         │
│  • Total Configured: 8 automations                                 │
│  • Currently Running: 2 jobs                                       │
│  • Last 24h: 47 executions (45 success, 2 failed)                  │
│  • Next scheduled: Zoho Sync in 12 minutes                         │
│                                                                     │
│  🟢 ACTIVE AUTOMATIONS (8)                                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Zoho Books Sync                              🔄 RUNNING    │ │
│  │ Schedule: Every 30 minutes                                    │ │
│  │ Last run: 2 minutes ago (Success)                             │ │
│  │ Next run: In 28 minutes                                       │ │
│  │ Status: Syncing 15 invoices...                                │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Run Now]                                 │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Collection Reminders (WhatsApp)              ✓ Active      │ │
│  │ Schedule: Daily at 10:00 AM                                   │ │
│  │ Last run: Today 10:05 AM (Sent 23 reminders)                  │ │
│  │ Next run: Tomorrow 10:00 AM                                   │ │
│  │ Success rate: 95% (22/23 delivered)                           │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Edit Schedule]                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Stock Reorder Alerts                         ✓ Active      │ │
│  │ Schedule: Every 6 hours                                       │ │
│  │ Last run: 3 hours ago (0 alerts sent)                         │ │
│  │ Next run: In 3 hours                                          │ │
│  │ Status: All items above reorder levels                        │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Configure Thresholds]                    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Daily Task Auto-Assignment                   ✓ Active      │ │
│  │ Schedule: Daily at 9:00 AM                                    │ │
│  │ Last run: Today 9:00 AM (Assigned 12 tasks)                   │ │
│  │ Next run: Tomorrow 9:00 AM                                    │ │
│  │ Staff notified: 11/11 (100%)                                  │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Edit Tasks]                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Overdue Invoice Escalation                   ✓ Active      │ │
│  │ Schedule: Daily at 5:00 PM                                    │ │
│  │ Last run: Yesterday 5:00 PM (Escalated 15 invoices)           │ │
│  │ Next run: Today 5:00 PM (in 5 hours)                          │ │
│  │ Target: Invoices overdue > 30 days                            │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Edit Rules]                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ AI Insights Generator                        ✓ Active      │ │
│  │ Schedule: Daily at 6:00 AM                                    │ │
│  │ Last run: Today 6:00 AM (Generated 11 insights)               │ │
│  │ Next run: Tomorrow 6:00 AM                                    │ │
│  │ Critical alerts: 11 unread                                    │ │
│  │                                                                │ │
│  │ [View Insights] [Pause] [Configure AI]                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Stock Check Deadline Reminders               ✓ Active      │ │
│  │ Schedule: 2 hours before due time                             │ │
│  │ Last run: 12:00 PM (Sent 3 reminders)                         │ │
│  │ Next run: When next stock check due - 2h                      │ │
│  │ Pending: Main Branch check (due 6:00 PM)                      │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Edit Timing]                             │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ✅ Attendance Auto-Report (Email)               ✓ Active      │ │
│  │ Schedule: Daily at 11:00 PM                                   │ │
│  │ Last run: Yesterday 11:00 PM (Sent to 2 emails)               │ │
│  │ Next run: Today 11:00 PM (in 11 hours)                        │ │
│  │ Recipients: owner@qcpaintshop.com, manager@...               │ │
│  │                                                                │ │
│  │ [View Logs] [Pause] [Edit Recipients]                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ⚠️ FAILED JOBS (Last 24h)                                         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ❌ Zoho Books Sync                                            │ │
│  │ Failed: Today 8:30 AM                                         │ │
│  │ Error: API timeout (429 Too Many Requests)                    │ │
│  │ Status: Retried successfully at 8:45 AM                       │ │
│  │                                                                │ │
│  │ [View Error Log] [Mark Resolved]                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ❌ Collection Reminder                                        │ │
│  │ Failed: Today 10:05 AM                                        │ │
│  │ Error: WhatsApp API connection timeout                        │ │
│  │ Status: Manually resent at 10:30 AM                           │ │
│  │                                                                │ │
│  │ [View Error Log] [Mark Resolved]                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [+ Add New Automation] [View All Logs] [Export Report]            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Live Activity Feed (Bottom Section)

```
┌─────────────────────────────────────────────────────────────────────┐
│  📡 LIVE ACTIVITY FEED                              [Pause Updates] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🕐 2 seconds ago                                                   │
│  📦 Manikandan saved progress on Stock Check (Main Branch)          │
│     → Checked 3 more items (245/1,109 total)                        │
│                                                                     │
│  🕐 15 seconds ago                                                  │
│  📞 Syed Sickandar completed task: Customer Follow-up (Murugan)     │
│     → Marked as complete with note "Order confirmed for next week"  │
│                                                                     │
│  🕐 45 seconds ago                                                  │
│  ⚙️ Automation: Zoho Books Sync completed                           │
│     → Synced 15 invoices, 8 payments                                │
│                                                                     │
│  🕐 1 minute ago                                                    │
│  ⚠️ Ramana Kishore reported discrepancy in stock check              │
│     → Berger Weathercoat 4L: System 8.0, Counted 6.0 (Short 2.0)    │
│                                                                     │
│  🕐 2 minutes ago                                                   │
│  👤 Syed clocked in at QC - Main Branch                             │
│     → Geolocation: Within 50m of branch                             │
│                                                                     │
│  🕐 3 minutes ago                                                   │
│  💰 New payment received: ₹25,000 from Murugan Construction         │
│     → Invoice #INV-2026-245 (overdue cleared)                       │
│                                                                     │
│  🕐 5 minutes ago                                                   │
│  📋 Task auto-assigned: Daily Sales Report → Manikandan             │
│     → Due: Tomorrow 9:00 AM                                         │
│                                                                     │
│  🕐 8 minutes ago                                                   │
│  📦 Stock Check assignment created                                  │
│     → Main Branch: 1,109 items assigned to Manikandan               │
│                                                                     │
│  [Load More] [Filter by Type] [Export Activity Log]                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Auto-scroll (newest at top)
- Real-time updates (WebSocket)
- Color-coded icons
- Click any activity → Full details
- Filter by: Staff, Branch, Type, Time

---

## Key Metrics Cards (Expandable)

### Staff Performance Today

```
┌─────────────────────────────────────────────────────────────┐
│  📊 STAFF PERFORMANCE - TODAY                  [▼ Expand]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Branch: All     Status: All     Sort: Productivity ↓       │
│                                                             │
│  Staff            Tasks    Stock    Hours   Productivity   │
│  ───────────────────────────────────────────────────────   │
│  Manikandan       3/4      22%     2h 15m   ⭐⭐⭐⭐⭐      │
│  Ramana Kishore   2/2      12%     1h 30m   ⭐⭐⭐⭐        │
│  Syed Sickandar   1/1      —       45m      ⭐⭐⭐⭐        │
│  Syed             2/2      —       2h 45m   ⭐⭐⭐          │
│  ...                                                        │
│                                                             │
│  [View Detailed Report] [Export CSV]                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Branch-wise Activity

```
┌─────────────────────────────────────────────────────────────┐
│  🏢 BRANCH ACTIVITY - REAL-TIME               [▼ Expand]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Branch              Staff   Tasks   Stock    Revenue      │
│  ──────────────────────────────────────────────────────────│
│  QC - Main           3/3     5 🟢   22% 🟡   ₹0 today      │
│  QC - Thangachimadam 2/2     2 🟢   12% 🟡   ₹0 today      │
│  QC - Paramakudi     1/2     1 🟢   0% 🔴    ₹0 today      │
│  QC - Rameswaram     0/1     0 🔴   0% 🔴    ₹0 today      │
│  QC - Pamban         0/1     0 🔴   0% 🔴    ₹0 today      │
│                                                             │
│  [View Branch Dashboard] [Compare Branches]                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Real-Time Features

### WebSocket Updates

**Events to track live:**
```javascript
{
  // Staff activity
  "staff.clockin": { staff_id, branch_id, time },
  "staff.clockout": { staff_id, hours_worked },
  "staff.task.start": { staff_id, task_id, task_type },
  "staff.task.update": { staff_id, task_id, progress },
  "staff.task.complete": { staff_id, task_id, duration },
  
  // Stock checks
  "stockcheck.start": { assignment_id, staff_id },
  "stockcheck.progress": { assignment_id, checked, total, pct },
  "stockcheck.discrepancy": { assignment_id, item_id, diff },
  "stockcheck.complete": { assignment_id, duration, discrepancies },
  
  // Automations
  "automation.start": { automation_id, name },
  "automation.progress": { automation_id, step, total_steps },
  "automation.complete": { automation_id, status, duration },
  "automation.error": { automation_id, error_message },
  
  // System
  "payment.received": { invoice_id, amount, customer },
  "invoice.created": { invoice_id, branch_id, amount },
  "sync.started": { type, items_count },
  "sync.completed": { type, synced_count, errors }
}
```

**Update frequency:**
- Critical events: Instant (WebSocket push)
- Metrics: Every 10 seconds
- Activity feed: Real-time stream
- Automation status: Every 30 seconds

---

## Mobile Responsive Layout

### Mobile View (Compact)

```
┌─────────────────────────────┐
│ 🟢 ADMIN - LIVE      [⚙️]  │
├─────────────────────────────┤
│                             │
│ 👥 STAFF      📋 WORK       │
│ 7/11 online   5 tasks       │
│ 🟢 5 working  3 checks      │
│                             │
│ ⚙️ AUTOMATIONS              │
│ 8 active • 2 running        │
│ [View All →]                │
│                             │
│ 📡 LIVE FEED                │
│ • Manikandan: Saved 3 items │
│ • Sickandar: Completed task │
│ • Sync: 15 invoices synced  │
│                             │
│ [Expand Details]            │
│                             │
└─────────────────────────────┘
```

---

## API Endpoints

### Get Live Dashboard Data

```
GET /api/admin/dashboard/live
```

**Response:**
```json
{
  "success": true,
  "data": {
    "staff_online": 7,
    "staff_total": 11,
    "staff_working": 5,
    "staff_idle": 2,
    "tasks_active": 5,
    "stockchecks_active": 3,
    "tasks_overdue": 2,
    
    "automations": {
      "total": 8,
      "active": 8,
      "running": 2,
      "failed_24h": 2,
      "success_rate": 95.7
    },
    
    "revenue_today": 0,
    "collections_today": 65000,
    "overdue_amount": 2080000,
    "overdue_count": 384,
    
    "alerts_critical": 11,
    
    "staff_activity": [
      {
        "staff_id": 6,
        "name": "Manikandan",
        "branch": "QC - Main Branch",
        "status": "working",
        "current_work": {
          "type": "stock_check",
          "assignment_id": 16,
          "title": "Main Branch - 1,109 items",
          "progress_pct": 22,
          "progress_text": "245/1,109",
          "last_activity": "Checking Asian Paints Tractor Emulsion",
          "last_saved": "2026-02-24T14:15:00+05:30",
          "duration_minutes": 135
        }
      }
    ],
    
    "automation_status": [
      {
        "id": 1,
        "name": "Zoho Books Sync",
        "type": "sync",
        "schedule": "every_30_minutes",
        "status": "running",
        "last_run": "2026-02-24T14:15:00+05:30",
        "last_status": "success",
        "next_run": "2026-02-24T14:45:00+05:30",
        "executions_24h": 48,
        "success_rate": 97.9
      }
    ],
    
    "recent_activity": [
      {
        "timestamp": "2026-02-24T14:17:30+05:30",
        "type": "stockcheck.progress",
        "staff_name": "Manikandan",
        "description": "Saved progress on Stock Check (Main Branch)",
        "details": "Checked 3 more items (245/1,109 total)"
      }
    ]
  },
  "timestamp": "2026-02-24T14:17:32+05:30"
}
```

---

### Get Automation Details

```
GET /api/admin/automations/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Zoho Books Sync",
    "type": "sync",
    "enabled": true,
    "schedule": {
      "type": "interval",
      "interval_minutes": 30,
      "next_run": "2026-02-24T14:45:00+05:30"
    },
    "last_runs": [
      {
        "timestamp": "2026-02-24T14:15:00+05:30",
        "status": "success",
        "duration_ms": 3250,
        "items_synced": 15,
        "errors": []
      }
    ],
    "stats": {
      "total_executions": 450,
      "success_count": 445,
      "fail_count": 5,
      "success_rate": 98.9,
      "avg_duration_ms": 2800
    }
  }
}
```

---

## Notifications & Alerts

### Admin Alert Types

**Critical (Red):**
- Automation failed 3+ times in a row
- Staff overdue on critical task (> 2 hours)
- System sync error (Zoho, payment gateway)
- Stock check discrepancy > 20%

**Warning (Yellow):**
- Staff idle for > 30 minutes during work hours
- Automation retry (1st or 2nd attempt)
- Stock check progress < 10% with 2 hours remaining
- Task completion rate < 70%

**Info (Blue):**
- Automation completed successfully
- Staff completed all assigned tasks
- Stock check submitted
- Daily goals achieved

---

## Quick Actions Panel

```
┌─────────────────────────────────────────┐
│  ⚡ QUICK ACTIONS               [⚙️]   │
├─────────────────────────────────────────┤
│                                         │
│  [📋 Assign Task to All Staff]         │
│  [📦 Create Stock Check (All Branches)] │
│  [📢 Send Broadcast Message]            │
│  [⏸️ Pause All Automations]             │
│  [🔄 Force Sync Now (Zoho)]             │
│  [📊 Generate Performance Report]       │
│  [⚠️ Send Alert to Absent Staff]        │
│                                         │
└─────────────────────────────────────────┘
```

---

## Testing Checklist

### Real-Time Features
- [ ] Dashboard updates within 10 seconds of staff activity
- [ ] WebSocket connection stable (auto-reconnect on drop)
- [ ] Live counters accurate (staff online, tasks active)
- [ ] Activity feed shows events instantly
- [ ] Automation status updates in real-time

### Performance
- [ ] Dashboard loads < 3 seconds (with all data)
- [ ] No lag with 50+ active staff
- [ ] Smooth animations (progress bars, status updates)
- [ ] Mobile responsive (all cards stack properly)

### Data Accuracy
- [ ] Staff status matches actual activity
- [ ] Progress percentages calculate correctly
- [ ] Automation success rates accurate
- [ ] Timestamp display in IST (not UTC/CET)

---

## Success Metrics

**Before (Manual Monitoring):**
- Manager checks WhatsApp for staff updates ❌
- No visibility into stock check progress ❌
- Automation failures discovered hours later ❌
- Can't see who's working on what ❌

**After (Live Dashboard):**
- Real-time visibility: See all activity instantly ✅
- Proactive alerts: Know about issues immediately ✅
- Data-driven decisions: Metrics at a glance ✅
- Staff accountability: Track productivity live ✅

---

## Implementation Phases

### Phase 1 (5-7 days)
- [ ] Live staff activity panel
- [ ] Automation status cards
- [ ] Basic activity feed
- [ ] Top metrics bar
- [ ] WebSocket integration

### Phase 2 (7-10 days)
- [ ] Branch-wise breakdown
- [ ] Staff performance metrics
- [ ] Automation logs + history
- [ ] Quick actions panel
- [ ] Mobile responsive layout

### Phase 3 (10-15 days)
- [ ] Advanced filtering (by branch, type, date)
- [ ] Export reports (PDF, CSV)
- [ ] Custom alerts configuration
- [ ] Analytics dashboard
- [ ] Historical trend charts

---

**Total Implementation:** 22-32 working days

---

**End of Specification**

Save location: `/www/wwwroot/act.qcpaintshop.com/docs/ADMIN-DASHBOARD-LIVE-MONITORING-SPEC.md`

Share with Claude Code for implementation.
