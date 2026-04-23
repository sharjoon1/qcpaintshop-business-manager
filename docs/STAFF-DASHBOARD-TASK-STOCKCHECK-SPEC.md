# Staff Dashboard - Task & Stock Check Design Specification

**Date:** 2026-02-24  
**For:** Claude Code (Developer)  
**Component:** Staff Dashboard UI - Tasks + Stock Check Integration

---

## Business Requirement (Tamil + English)

> **Tamil:** "ஸ்டாஃப் டேஷ் போர்டை சிறந்த முறையில் வடிவமைப்பதற்கும் டாஸ்க் & Stock Check அசைன் செய்தால் அது முதலில் மெயின் நோட்டிபிகேஷன் ஆக போர்டில் தெரியும் விதத்தில் இருக்குமாறு டிசைன் செய்வதற்கும்"

> **English:** "Design the staff dashboard optimally so that when Tasks OR Stock Check assignments are assigned, they appear as the PRIMARY/MAIN notification prominently on the dashboard."

---

## Core Principles

### 1. Unified Task View
- **Stock checks = High-priority tasks**
- Both regular tasks and stock checks use same visual system
- Stock checks get special treatment (higher priority)

### 2. Priority Hierarchy
```
1. NEW Stock Check Assignment (< 5 min)     → RED pulsing, urgent
2. Overdue Stock Check                      → RED background, critical
3. NEW Regular Task (< 5 min)               → RED pulsing
4. In-progress Stock Check                  → YELLOW, with progress %
5. Overdue Regular Task                     → ORANGE, urgent
6. In-progress Regular Task                 → YELLOW
7. Pending Stock Check                      → BLUE
8. Pending Regular Task                     → GRAY
9. Completed (any)                          → GREEN, auto-hide
```

### 3. Stock Check Special Treatment
- **Larger card** (20% taller than regular tasks)
- **Distinct icon** (📦 for stock checks vs 📋 for tasks)
- **Progress tracking built-in** (245/1,109 items checked)
- **Auto-save indicator** ("Last saved 5 min ago")

---

## Dashboard Layout

### Top Section: Active Assignments (Priority View)

```
┌─────────────────────────────────────────────────────────┐
│  📋 YOUR WORK (4 pending)              [Sort ▼] [Filter]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 📦 STOCK CHECK          [NEW]                     │ │ ← Larger card
│  │ 🔴 Main Branch - Full Inventory                   │ │ ← Red pulsing border
│  │                                                    │ │
│  │ 📊 Progress: 0/1,109 items (0%)                   │ │
│  │ ⏰ Due: Today 6:00 PM (8 hours left)              │ │
│  │ 📍 Head Office Store Location                     │ │
│  │                                                    │ │
│  │ [▶ Start Checking]  [View Details]                │ │ ← Large buttons
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 📦 STOCK CHECK          [22% ✓]                   │ │
│  │ 🟡 Thangachimadam - In Progress                   │ │ ← Yellow border
│  │                                                    │ │
│  │ ████████░░░░░░░░░░░░░░░░░░ 162/737 items         │ │ ← Progress bar
│  │ ⏰ Due: Today 6:00 PM                             │ │
│  │ 💾 Last saved: 5 minutes ago                      │ │
│  │                                                    │ │
│  │ [▶ Continue]  [💾 Save & Pause]                   │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 📞 REGULAR TASK         [NEW]                     │ │ ← Regular task (smaller)
│  │ Customer Follow-up: Murugan                       │ │
│  │ Due: Today 3:00 PM                                │ │
│  │ [Start]                                           │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 📝 REGULAR TASK         [PENDING]                 │ │
│  │ Daily Sales Report                                │ │
│  │ Due: Tomorrow 9:00 AM                             │ │
│  │ [View]                                            │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Stock Check Card Components

### NEW Stock Check (Just Assigned)

```
┌─────────────────────────────────────────────────────┐
│ 📦 STOCK CHECK ASSIGNED!    [NEW] [🔴 URGENT]      │ ← Red pulsing glow
│ Main Branch - Full Inventory Check                 │
│                                                     │
│ 📊 Items to verify: 1,109 products                 │
│ 📍 Location: Head Office (Store)                   │
│ ⏰ Assigned: Just now                              │
│ 🎯 Due: Today 6:00 PM (8 hours left)               │
│                                                     │
│ ℹ️  You can save progress anytime — no need to     │
│    complete all items in one session.              │
│                                                     │
│ [▶ Start Checking Now]    [View Item List]         │
└─────────────────────────────────────────────────────┘
```

**Visual Effects:**
- Red pulsing border (2px, animated)
- "NEW" badge (top-right, red)
- "URGENT" indicator if due today
- Slightly larger font (120% of regular tasks)

---

### In-Progress Stock Check

```
┌─────────────────────────────────────────────────────┐
│ 📦 STOCK CHECK              [22% COMPLETE]         │ ← Yellow border
│ Thangachimadam - Ongoing                           │
│                                                     │
│ Progress: 162/737 items verified                   │
│ ████████░░░░░░░░░░░░░░░░░░ 22%                    │ ← Animated progress bar
│                                                     │
│ ⚠️  Discrepancies found: 5 items                   │
│ 💾 Last saved: 5 minutes ago                       │
│ ⏰ Due: Today 6:00 PM (7h 45m left)                │
│                                                     │
│ Quick Stats:                                       │
│ • Checked: 162 ✅                                  │
│ • Remaining: 575 ⏸️                                │
│ • Mismatches: 5 ⚠️                                 │
│                                                     │
│ [▶ Continue Checking]  [💾 Save & Pause]           │
│ [📊 View Discrepancies]                            │
└─────────────────────────────────────────────────────┘
```

**Real-time Updates:**
- Progress bar animates smoothly
- Auto-refresh every 30 seconds
- "Last saved" updates dynamically

---

### Completed Stock Check

```
┌─────────────────────────────────────────────────────┐
│ 📦 STOCK CHECK              [✅ COMPLETED]         │ ← Green border
│ Pamban - Submitted for Review                      │
│                                                     │
│ ✅ All 373 items verified                          │
│ ⚠️  Found 2 discrepancies                          │
│ ✓  Submitted: 15 minutes ago                       │
│ ⏰ Completed: On time (2h early)                   │
│                                                     │
│ [View Submission]  [Download Report]               │
└─────────────────────────────────────────────────────┘
```

**Auto-collapse:**
- Stays visible for 1 hour after completion
- Then moves to "Completed" tab
- Can be manually collapsed by staff

---

## Notification System

### When Stock Check is Assigned

**Step 1: Push Notification (Device)**
```
┌─────────────────────────────────────────┐
│ 📦 New Stock Check Assigned!            │
│ Main Branch - 1,109 items               │
│ Due: Today 6:00 PM                      │
│ Tap to start →                          │
└─────────────────────────────────────────┘
```

**Step 2: In-App Banner (Slides from Top)**
```
┌─────────────────────────────────────────────────┐
│ ⚡ URGENT: Stock Check Assigned!                │ ← Full-width banner
│ Main Branch - 1,109 items • Due today 6 PM     │
│                                                 │
│ [Start Now]  [View Details]  [Later]            │
└─────────────────────────────────────────────────┘
```
- Red background
- Auto-dismiss after 15 seconds
- Can be swiped away
- Reappears if not acted upon within 1 hour

**Step 3: Dashboard Card (Persistent)**
- Appears at TOP of task list
- Red pulsing border
- "NEW" badge
- Larger than regular tasks

**Step 4: Badge Count**
- App icon shows: "1" (new stock check)
- Updates in real-time

---

### When Regular Task is Assigned

**Same system, but:**
- Orange background (not red)
- Standard size card
- Lower priority in sort order

---

## Auto-Sorting Logic (Combined View)

**Sort order when both tasks + stock checks exist:**

```
Priority Order:
1. 🔴 NEW Stock Check (< 5 min old)
2. 🔴 OVERDUE Stock Check
3. 🔴 NEW Regular Task (< 5 min old)
4. 🟡 IN PROGRESS Stock Check (with progress %)
5. 🟠 OVERDUE Regular Task
6. 🟡 IN PROGRESS Regular Task
7. 🔵 PENDING Stock Check (not started, due today)
8. ⚪ PENDING Regular Task (due today)
9. 🔵 PENDING Stock Check (due later)
10. ⚪ PENDING Regular Task (due later)
11. ✅ COMPLETED (any type, auto-collapse)
```

**Visual Indicators:**
- Stock checks: Always have 📦 icon
- Regular tasks: Use contextual icons (📞 📝 💰 etc.)

---

## Stock Check Quick Actions

### Swipe Right (Quick Start)
```
[▶ START] ← Swipe → Stock Check Card
```
- Opens stock check interface immediately
- No confirmation needed

### Swipe Left (Options)
```
Stock Check Card ← Swipe → [⏰ Snooze] [ℹ️ Details] [❌ Decline]
```
- Snooze: Remind in 1 hour
- Details: Full item list + instructions
- Decline: Notify manager (requires reason)

### Long Press (Full Menu)
```
┌──────────────────────────┐
│ Stock Check Options      │
│ • Start Checking         │
│ • View Item List         │
│ • See Location Details   │
│ • Request Help           │
│ • Snooze 1 Hour          │
│ • Decline Assignment     │
└──────────────────────────┘
```

---

## Filter & Tab System

### Top Tabs (Quick Filter)
```
[ All (4) ] [ Stock Checks (2) ] [ Tasks (2) ] [ Completed (5) ]
```

**When "Stock Checks" tab selected:**
- Show only stock check assignments
- Group by status: New → In Progress → Pending → Completed
- Show summary stats at top

---

## Stock Check Dashboard Summary (Collapsible)

**At top of dashboard (can be collapsed):**

```
┌─────────────────────────────────────────────────────┐
│ 📦 STOCK CHECK SUMMARY                    [▼ Hide] │
│                                                     │
│ Active: 2 assignments                              │
│ • Main Branch: 0/1,109 (0%) — Not started         │
│ • Thangachimadam: 162/737 (22%) — In progress     │
│                                                     │
│ Overall Progress: 162/1,846 items (9%)             │
│ ████░░░░░░░░░░░░░░░░░░░░░░░░░░                    │
│                                                     │
│ Completed Today: 1 assignment                      │
│ • Pamban: 373/373 ✅ (2 discrepancies)            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Default:** Collapsed (show icon + count only)  
**Tap to expand:** Full stats

---

## Integration with Stock Check Interface

### From Dashboard → Stock Check Screen

**Flow:**
1. Staff taps "Start Checking" on card
2. Transition animation (card expands to full screen)
3. Stock check interface opens with:
   - Items list (filtered: Unchecked first)
   - Progress bar at top
   - "Save Progress" button (sticky footer)
   - "Submit Final" (when 100% complete)

**Navigation:**
- Back button → Returns to dashboard
- Progress saved automatically
- Can switch to other tasks and return

---

## Stock Check Item Checking UI (Integrated View)

### Item List View
```
┌─────────────────────────────────────────────────────┐
│ Stock Check: Main Branch        [22% • 245/1,109]  │
│ [ All ] [ Unchecked (864) ] [ Checked ] [ Issues ] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ○ Asian Paints Tractor Emulsion - White - 20L     │ ← Unchecked
│   SKU: AP-TE-WHT-20L                               │
│   System Qty: 10.0                                 │
│   [Enter Count] [📷 Photo]                         │
│                                                     │
│ ✓ Asian Paints Apex Exterior - Smoke - 10L        │ ← Checked
│   SKU: AP-AE-SMK-10L                               │
│   System: 15.0 | Counted: 15.0 | ✅ Match          │
│                                                     │
│ ⚠️ Berger Weathercoat - Red Oxide - 4L             │ ← Discrepancy
│   SKU: BG-WC-RO-4L                                 │
│   System: 8.0 | Counted: 6.0 | ❌ Short 2.0        │
│   Note: "2 cans damaged, photo attached"           │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ [💾 Save Progress (12 new)]  [← Back to Dashboard] │ ← Sticky footer
└─────────────────────────────────────────────────────┘
```

---

## Performance Indicators (Top-Right)

**Always visible on dashboard:**
```
┌─────────────────────────────────────────────┐
│ Dashboard              [95% ⭐] [🔔 3]     │
│                        ↑ This week          │
└─────────────────────────────────────────────┘
```

**Metrics:**
- Task completion rate (stock checks + regular tasks)
- On-time completion %
- Notification badge count

---

## Empty States

### No Stock Checks Assigned
```
┌─────────────────────────────────────┐
│         📦                          │
│   No Stock Checks Assigned          │
│   All inventory up to date!         │
│                                     │
│ [View Completed Checks]             │
└─────────────────────────────────────┘
```

### All Work Complete
```
┌─────────────────────────────────────┐
│         🎉                          │
│   All Caught Up!                    │
│                                     │
│ Tasks: 5/5 completed ✅             │
│ Stock Checks: 2/2 submitted ✅      │
│                                     │
│ Great work today!                   │
│ [View Summary]                      │
└─────────────────────────────────────┘
```

---

## Real-Time Updates

### Stock Check Progress Sync

**When staff is checking items:**
- Progress updates every item entry
- Auto-save every 5 items (or 2 minutes)
- Visual feedback: "Saving..." → "Saved ✓"
- Sync across devices (if staff switches phone/tablet)

**Dashboard updates:**
- Progress bar animates smoothly
- "Last saved" timestamp updates
- Discrepancy count updates
- Completed count increments

---

## Technical Requirements

### API Endpoints (Stock Check Specific)

**Get Stock Check Assignments:**
```
GET /api/stock-check/my-assignments?status=pending,in_progress
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 16,
      "type": "stock_check",
      "branch_name": "QC - Main Branch",
      "location_name": "Head Office (Store)",
      "total_items": 1109,
      "checked_items": 0,
      "progress_pct": 0,
      "status": "pending",
      "due_date": "2026-02-24T18:00:00+05:30",
      "assigned_at": "2026-02-24T09:00:00+05:30",
      "is_new": true
    }
  ]
}
```

**Get Combined Dashboard:**
```
GET /api/dashboard/my-work?include=tasks,stock_checks
```

**Response:**
```json
{
  "success": true,
  "stock_checks": [...],
  "tasks": [...],
  "summary": {
    "total_pending": 4,
    "stock_checks_active": 2,
    "tasks_active": 2,
    "completion_rate_week": 95
  }
}
```

---

## Notification Payload

### Stock Check Assignment
```json
{
  "type": "stock_check_assigned",
  "title": "📦 Stock Check Assigned",
  "body": "Main Branch - 1,109 items • Due today 6 PM",
  "priority": "urgent",
  "sound": "urgent_alert.mp3",
  "vibrate": [200, 100, 200],
  "data": {
    "assignment_id": 16,
    "branch_name": "Main Branch",
    "item_count": 1109,
    "due_time": "18:00",
    "action": "open_stock_check"
  }
}
```

---

## Testing Checklist

### Stock Check Integration
- [ ] New stock check appears within 5 sec of assignment
- [ ] Stock check sorted above regular tasks (when NEW)
- [ ] Progress bar updates in real-time
- [ ] "Last saved" timestamp accurate
- [ ] Discrepancy count updates correctly
- [ ] Can switch to other tasks and return to stock check
- [ ] Partial save works (no data loss)
- [ ] Final submit only enabled at 100%

### Cross-Task Interactions
- [ ] Can work on stock check + regular task simultaneously
- [ ] Switching tasks doesn't lose progress
- [ ] Notifications don't overlap (queue properly)
- [ ] Badge count accurate (stock checks + tasks)

### Visual Tests
- [ ] Stock check cards 20% larger than task cards
- [ ] Red pulsing animation smooth
- [ ] Progress bar accurate
- [ ] Icons consistent (📦 for stock checks)
- [ ] Responsive on mobile, tablet

---

## Success Metrics

**Before Redesign:**
- Stock checks missed: 20%
- Completion time: 3-5 days per assignment
- Staff don't know they have stock check until asked

**After Redesign (Target):**
- Stock checks missed: < 2%
- Completion time: 1-2 days (with partial save)
- Staff start within 15 min of assignment

**KPIs:**
- Stock check start time (< 15 min from assignment)
- Partial save usage (staff save progress regularly)
- Completion rate (95%+ on-time)
- Discrepancy detection rate (accurate reporting)

---

## Implementation Phases

### Phase 1 (MVP - 5-7 days)
- [ ] Combined dashboard (tasks + stock checks)
- [ ] Stock check card layout (larger, distinct)
- [ ] NEW badge + push notifications
- [ ] Priority sorting (stock checks first)
- [ ] Basic progress display

### Phase 2 (Enhanced - 7-10 days)
- [ ] In-progress tracking (progress bar, stats)
- [ ] Real-time updates (WebSocket/polling)
- [ ] Swipe actions (start, pause, details)
- [ ] Auto-save indicator
- [ ] Discrepancy highlighting

### Phase 3 (Advanced - 10-15 days)
- [ ] Offline mode (save locally, sync later)
- [ ] Voice input for counts
- [ ] Barcode scanning integration
- [ ] Analytics (completion trends)
- [ ] Smart notifications (time-based reminders)

---

**Total Implementation Time:** 22-32 working days

---

## Questions for Developer

1. **Current task system exists?** Or building from scratch?
2. **Push notification service?** (Firebase, OneSignal, custom?)
3. **Stock check table structure?** (stock_check_assignments + stock_check_items confirmed?)
4. **Mobile app or web?** (React Native, Flutter, PWA?)
5. **Real-time preferred method?** (WebSocket vs polling?)

---

**End of Specification**

Save location: `/www/wwwroot/act.qcpaintshop.com/docs/STAFF-DASHBOARD-TASK-STOCKCHECK-SPEC.md`

Share with Claude Code for implementation.
