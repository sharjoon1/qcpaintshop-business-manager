# Staff Dashboard Redesign - Developer Specification

**Date:** 2026-02-24  
**Requested by:** Sharjoon (Quality Colours Owner)  
**For:** Claude Code (Developer)  
**Component:** Staff Dashboard UI (Mobile/Web)

---

## Business Requirement (in Tamil)

> "ஸ்டாஃப் டேஷ் போர்டை சிறந்த முறையில் வடிவமைப்பதற்கும் டாஸ்க் அசைன் செய்தால் அது முதலில் மெயின் நோட்டிபிகேஷன் ஆக போர்டில் தெரியும் விதத்தில் இருக்குமாறு டிசைன் செய்வதற்கும்"

**Translation:**
Design the staff dashboard in the best way possible, ensuring that when a task is assigned, it appears as the **main/primary notification** prominently on the dashboard.

---

## Core Principles

### 1. Task-First Design
- **Assigned tasks = Top priority** — must be immediately visible
- No scrolling required to see new tasks
- Clear visual hierarchy: Tasks > Attendance > Other info

### 2. Action-Oriented
- Staff should know **what to do next** within 3 seconds of opening the app
- Reduce cognitive load — highlight actionable items only
- Hide/collapse completed or non-urgent info

### 3. Mobile-First
- 90% of staff use mobile devices
- Large touch targets (min 44x44px)
- One-handed navigation
- Works on slow 3G networks

---

## Dashboard Layout (Recommended Structure)

### Top Section: **Active Tasks & Notifications**

```
┌─────────────────────────────────────────────┐
│  📋 YOUR TASKS (3 pending)                  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🔴 NEW TASK ASSIGNED!               │   │
│  │ Stock Check - Main Branch            │   │
│  │ 1,109 items to verify                │   │
│  │ Due: Today, 6:00 PM                  │   │
│  │ [Start Now]                          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🟡 IN PROGRESS                       │   │
│  │ Customer Follow-up: Murugan          │   │
│  │ Last contact: 2 days ago             │   │
│  │ [Call Now]  [Mark Done]              │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🟢 UPCOMING                          │   │
│  │ Daily Sales Report                   │   │
│  │ Due: Tomorrow, 9:00 AM               │   │
│  │ [View Details]                       │   │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

**Visual Hierarchy:**
1. **🔴 NEW** (Red badge) — Just assigned (< 5 min ago)
2. **🟡 IN PROGRESS** (Yellow) — Started but not complete
3. **🟢 UPCOMING** (Green) — Scheduled for later

---

### Middle Section: **Quick Actions**

```
┌─────────────────────────────────────────────┐
│  QUICK ACTIONS                              │
│                                             │
│  [📷 Stock Check] [💰 Record Sale]         │
│  [📞 Follow-up]   [📝 Daily Report]        │
│                                             │
└─────────────────────────────────────────────┘
```

**Context-aware buttons:**
- If stock check assigned → "📷 Stock Check" highlighted
- If sales target pending → "💰 Record Sale" highlighted

---

### Bottom Section: **Today's Summary (Collapsible)**

```
┌─────────────────────────────────────────────┐
│  TODAY'S SUMMARY  [▼ Expand]               │
│                                             │
│  ✅ Clock-in: 9:02 AM                      │
│  💵 Sales: ₹12,500 (3 invoices)            │
│  📦 Deliveries: 2 completed                │
│  ⏰ Hours: 2h 15m so far                   │
│                                             │
└─────────────────────────────────────────────┘
```

**Default:** Collapsed (show only icon counts)  
**Tap to expand:** Full details

---

## Task Notification Design

### New Task Assigned (Within 5 Minutes)

**Visual Treatment:**
- **Red pulsing border** around card
- **"NEW" badge** (top-right corner)
- **Push notification** + **In-app banner**
- **Auto-scroll** to task card on dashboard open

**Animation:**
```
┌─────────────────────────────────────┐
│ ⚡ NEW TASK ASSIGNED!               │ ← Slide down animation
│ Stock Check - 1,109 items           │
│ [View Task]  [Dismiss]              │
└─────────────────────────────────────┘
```

**Auto-dismiss:** After 10 seconds (but card stays on dashboard)

---

### Task Card States

#### 1. **New Task** (< 5 min old)
```
┌─────────────────────────────────────┐
│ 🔴 NEW                     [NEW]    │
│ Stock Check - Main Branch           │
│ Assigned: Just now                  │
│ Due: Today, 6:00 PM                 │
│ [Start Now]                         │
└─────────────────────────────────────┘
```
- Red border
- Pulsing glow effect
- Large "Start Now" button

---

#### 2. **Pending Task** (not started)
```
┌─────────────────────────────────────┐
│ ⏸️ PENDING                          │
│ Customer Follow-up: Rajesh          │
│ Assigned: 2 hours ago               │
│ Due: Today, 3:00 PM                 │
│ [Start]  [View Details]             │
└─────────────────────────────────────┘
```
- Orange border
- Standard layout

---

#### 3. **In Progress**
```
┌─────────────────────────────────────┐
│ ⏳ IN PROGRESS            [22% ✓]  │
│ Stock Check - 245/1,109 items       │
│ Last saved: 5 min ago               │
│ [Continue]  [Save & Pause]          │
└─────────────────────────────────────┘
```
- Yellow border
- Progress bar
- "Continue" button (primary action)

---

#### 4. **Overdue**
```
┌─────────────────────────────────────┐
│ ⚠️ OVERDUE                          │
│ Daily Sales Report                  │
│ Was due: Yesterday, 9:00 AM         │
│ [Complete Now]                      │
└─────────────────────────────────────┘
```
- Red background (urgent)
- Shake animation on first view

---

#### 5. **Completed**
```
┌─────────────────────────────────────┐
│ ✅ COMPLETED                        │
│ Stock Check - Main Branch           │
│ Completed: 10 min ago               │
│ [View Submission]                   │
└─────────────────────────────────────┘
```
- Green checkmark
- Faded background
- Auto-collapse after 1 hour

---

## Notification Flow

### When Task is Assigned:

**Step 1:** Push Notification (Device)
```
📋 New Task Assigned
Stock Check - Main Branch
1,109 items to verify
Tap to view →
```

**Step 2:** In-App Banner (When app is open)
```
┌─────────────────────────────────────────┐
│ ⚡ NEW TASK: Stock Check - Main Branch │
│ [View Now]  [Later]                     │
└─────────────────────────────────────────┘
```
- Slides from top
- Auto-dismiss after 10 sec

**Step 3:** Dashboard Card (Persistent)
- Task card appears at **top of list**
- Red pulsing border
- "NEW" badge

**Step 4:** Badge Count
- App icon shows red badge: "3" (pending tasks)
- Updates in real-time

---

## Priority & Sorting Logic

**Task order on dashboard:**

1. **Overdue tasks** (red, shake animation)
2. **New tasks** (< 5 min, red pulsing)
3. **In-progress tasks** (yellow, with progress %)
4. **Due today** (orange, sorted by time)
5. **Due tomorrow** (green)
6. **Completed today** (collapsed, gray)

**Auto-hide logic:**
- Completed tasks: Auto-collapse after 1 hour
- Tasks older than 7 days: Move to "History" tab

---

## Task Types & Icons

| Task Type | Icon | Color | Priority |
|-----------|------|-------|----------|
| Stock Check | 📦 | Blue | High |
| Customer Follow-up | 📞 | Orange | Medium |
| Daily Report | 📝 | Green | Low |
| Lead Assignment | 🎯 | Purple | High |
| Collection Call | 💰 | Red | High |
| Delivery | 🚚 | Teal | Medium |
| Training | 🎓 | Gray | Low |

**Custom icons:** Use consistent icon set (Material Icons or Font Awesome)

---

## Interaction Design

### Swipe Actions (Mobile)

**Swipe Right:**
```
[✅ Mark Done] ← Swipe → Task Card
```
- Quick complete without opening

**Swipe Left:**
```
Task Card ← Swipe → [⏰ Snooze] [🗑️ Decline]
```
- Snooze: Remind me in 1 hour
- Decline: Notify manager (requires reason)

**Long Press:**
```
┌─────────────────────┐
│ Task Options        │
│ • View Details      │
│ • Mark as Done      │
│ • Snooze 1 hour     │
│ • Request Help      │
│ • Decline Task      │
└─────────────────────┘
```

---

## Empty States

### No Tasks Assigned
```
┌─────────────────────────────────────┐
│         😊                          │
│    All Caught Up!                   │
│  No tasks assigned right now.       │
│                                     │
│  [View Completed] [Request Work]    │
└─────────────────────────────────────┘
```

### All Tasks Completed
```
┌─────────────────────────────────────┐
│         🎉                          │
│   Great Work Today!                 │
│ All 5 tasks completed on time.      │
│                                     │
│ [View Summary]                      │
└─────────────────────────────────────┘
```

---

## Performance Indicators

**Top-Right Corner (Always Visible):**
```
┌─────────────────────────────────────┐
│  Staff Dashboard        [95% ⭐]    │ ← Task completion rate
└─────────────────────────────────────┘
```

**Metrics:**
- Task completion rate (this week)
- On-time completion %
- Quality score (if applicable)

**Color coding:**
- 90-100%: Green ⭐
- 70-89%: Yellow ⚠️
- <70%: Red ❌

---

## Real-Time Updates

**WebSocket/Polling:**
- Check for new tasks every 30 seconds
- Push notification on new assignment
- Update badge counts instantly

**Visual feedback:**
```
┌─────────────────────────────────────┐
│  ⚡ New task assigned!              │ ← Slide animation
│  Tap to refresh                     │
└─────────────────────────────────────┘
```

**Pull-to-refresh:** Manual refresh option

---

## Accessibility

**Screen Readers:**
- Task cards: "New task: Stock Check, 1,109 items, due today 6 PM, start now button"
- Badge: "3 pending tasks"

**High Contrast Mode:**
- Increase border thickness
- Use solid colors (no gradients)

**Large Text:**
- Font scales up to 200% without breaking layout

---

## Technical Requirements

### API Endpoints (Existing?)

**Fetch Tasks:**
```
GET /api/tasks/my-tasks?status=pending,in_progress
```

**Mark Complete:**
```
POST /api/tasks/:id/complete
```

**Update Progress:**
```
POST /api/tasks/:id/progress
Body: { progress_pct: 22 }
```

### Database Schema (Reference)

**Table:** `staff_tasks`
- `id`, `staff_id`, `task_type`, `title`, `description`
- `status` ENUM: 'new', 'pending', 'in_progress', 'completed', 'overdue'
- `priority`: 'high', 'medium', 'low'
- `due_date`, `assigned_at`, `started_at`, `completed_at`
- `progress_pct` (0-100)

---

## Platform-Specific Considerations

### Mobile App (React Native / Flutter)
- Use native push notifications
- Badge count on app icon
- Local storage for offline mode

### Web App (React / Vue)
- Browser notifications (requires permission)
- Tab title updates: "(3) Staff Dashboard"
- Service worker for background updates

---

## Testing Checklist

### Functional Tests
- [ ] New task appears within 5 seconds of assignment
- [ ] "NEW" badge shows for first 5 minutes
- [ ] Push notification received
- [ ] Task sorting is correct (overdue → new → in-progress → pending)
- [ ] Swipe actions work (mark done, snooze)
- [ ] Progress updates in real-time
- [ ] Completed tasks auto-collapse after 1 hour

### Visual Tests
- [ ] Red pulsing animation on new tasks
- [ ] Progress bar accurate (22% = 22% width)
- [ ] Icons consistent across all task types
- [ ] Responsive layout (mobile, tablet, desktop)
- [ ] Dark mode support (if applicable)

### Performance Tests
- [ ] Dashboard loads in < 2 seconds
- [ ] 100+ tasks: No lag scrolling
- [ ] Real-time updates don't freeze UI
- [ ] Works on slow 3G network

---

## UI Mockup (ASCII)

**Full Dashboard Layout:**

```
┌─────────────────────────────────────────────┐
│  ☰  Staff Dashboard          [95% ⭐] 🔔(3) │
├─────────────────────────────────────────────┤
│                                             │
│  📋 YOUR TASKS (3 pending)                  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🔴 NEW                     [NEW]    │   │ ← Pulsing red border
│  │ Stock Check - Main Branch           │   │
│  │ 1,109 items • Due: Today 6 PM       │   │
│  │ Assigned: Just now                  │   │
│  │ [Start Now →]                       │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🟡 IN PROGRESS            [22% ✓]  │   │
│  │ Customer Follow-up: Murugan         │   │
│  │ ████████░░░░░░░░░░░░ 22/100         │   │
│  │ Last saved: 5 min ago               │   │
│  │ [Continue]  [Pause]                 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ ⏸️ PENDING                          │   │
│  │ Daily Sales Report                  │   │
│  │ Due: Tomorrow 9 AM                  │   │
│  │ [View Details]                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
├─────────────────────────────────────────────┤
│  QUICK ACTIONS                              │
│  [📷 Stock] [💰 Sale] [📞 Call] [📝 Report]│
├─────────────────────────────────────────────┤
│  TODAY'S SUMMARY  [▼]                      │
│  ✅ Clocked in: 9:02 AM                    │
│  💵 Sales: ₹12.5K (3 invoices)             │
│  ⏰ Hours: 2h 15m                          │
└─────────────────────────────────────────────┘
```

---

## Success Metrics

**Before Redesign:**
- Staff miss 30% of assigned tasks
- Average response time: 2 hours
- Complaints about "not seeing notifications"

**After Redesign (Target):**
- Task completion rate: 95%+
- Average response time: < 15 minutes
- Zero missed notifications

**KPIs to Track:**
- Task completion rate (%)
- On-time completion (%)
- Average time to start task (min)
- User satisfaction score (1-5)

---

## Implementation Priority

**Phase 1 (MVP):**
1. Task card layout with priority sorting
2. "NEW" badge for fresh assignments
3. Push notifications
4. Basic swipe actions

**Phase 2 (Enhanced):**
1. Progress tracking for in-progress tasks
2. Auto-collapse completed tasks
3. Performance indicators (completion rate)
4. Real-time updates via WebSocket

**Phase 3 (Advanced):**
1. Offline mode
2. Voice commands ("Show my tasks")
3. Smart notifications (time-based, location-based)
4. Analytics dashboard for managers

---

**End of Specification**

Save this doc in: `/www/wwwroot/act.qcpaintshop.com/docs/`  
Share with Claude Code for implementation.

---

## Questions for Developer

1. **Current Tech Stack?** (React Native, Flutter, React Web?)
2. **Push notification service?** (Firebase, OneSignal, custom?)
3. **Real-time updates?** (WebSocket, polling, Server-Sent Events?)
4. **Task data structure?** (Is `staff_tasks` table already created?)
5. **Design system?** (Material UI, Ant Design, custom components?)

---

**Implementation Timeline:**
- Phase 1 (MVP): 3-5 days
- Phase 2 (Enhanced): 5-7 days
- Phase 3 (Advanced): 10-15 days

**Total:** 18-27 working days for complete implementation.
