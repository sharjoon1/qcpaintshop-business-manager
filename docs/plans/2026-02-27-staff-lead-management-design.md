# Staff Lead Management System - Design Document

**Date:** 2026-02-27
**Status:** Approved

## Problem

The current lead management system is admin-only. Staff cannot see their assigned leads, log followups, or create new leads from field work. This limits marketing effectiveness since staff who interact with customers daily have no tool to track their leads.

## Solution

Staff-level lead isolation with a dedicated mobile-first page, auto-filtering by `assigned_to`, and a performance leaderboard for admins.

## Requirements (from brainstorming)

- **Both** staff and admin can create leads
- Staff creates lead → auto-assigned to self
- Admin sees all leads across branches; Manager sees branch leads; Staff sees only own leads
- **Full marketing toolkit**: Lead CRUD, Follow-ups, WhatsApp send, Performance stats, Today's tasks, Reminders, Pipeline view
- **Notifications**: In-app + Push for assignment, followup reminders, overdue alerts
- **Leaderboard**: Admin sees staff-wise conversion rates, followup counts, response time rankings

## Architecture

### Approach: Separate Staff Page + Enhanced Admin

- New `staff-leads.html` — dedicated mobile-first lead management page
- Enhanced `admin-leads.html` — new "Staff Performance" tab with leaderboard
- API auto-filtering by role in existing `routes/leads.js`

### Data Isolation (no new tables needed)

```
Staff role  → WHERE assigned_to = :userId
Manager     → WHERE branch_id = :userBranchId
Admin       → No filter (sees all)
```

Existing columns used: `leads.assigned_to`, `leads.branch_id`, `leads.created_by`

## Staff Page Design (`staff-leads.html`)

### Layout (Mobile-first)

```
┌──────────────────────────────────┐
│  My Leads          + Add Lead    │
├──────────────────────────────────┤
│ [Stats Cards - Scrollable Row]   │
│ Total:12 │ New:3 │ Today:2 │Won:5│
├──────────────────────────────────┤
│ [Filter Tabs]                    │
│ All │ Today's │ Overdue │ New    │
├──────────────────────────────────┤
│ [Search Bar]                     │
├──────────────────────────────────┤
│ ┌────────────────────────────┐   │
│ │ Rahul Kumar        HIGH   │   │
│ │ 9876543210   Walk-in      │   │
│ │ Follow-up: Today 2PM      │   │
│ │ [Call] [WhatsApp] [View]   │   │
│ └────────────────────────────┘   │
│ ┌────────────────────────────┐   │
│ │ Priya S.          MEDIUM  │   │
│ │ 9876543211   Referral     │   │
│ │ Follow-up: Tomorrow       │   │
│ │ [Call] [WhatsApp] [View]   │   │
│ └────────────────────────────┘   │
└──────────────────────────────────┘
```

### Features

1. **Stats Cards**: Total Leads, New Today, Follow-ups Today, Overdue, Converted (this month)
2. **Filter Tabs**: All / Today's Follow-ups / Overdue / New / Hot (AI score 80+)
3. **Lead Cards**: Name, phone, source, priority color, next followup, quick action buttons
4. **Quick Actions per lead**: Direct Call (tel: link), WhatsApp (wa.me link), View Details
5. **Add Lead Modal**: Name, Phone, Email, Source, Priority, Notes, Project Type, Property Type, Budget, Timeline
6. **Lead Detail Slide-out Panel**: Full info + followup history + add followup + status change
7. **Pipeline View** (toggle): Kanban columns (New -> Contacted -> Interested -> Quoted -> Negotiating -> Won)

## API Changes

### New Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/leads/my/stats` | Staff personal stats |
| `GET /api/leads/my/today` | Today's follow-ups + overdue |
| `GET /api/leads/performance/leaderboard` | Admin: staff ranking |
| `GET /api/leads/performance/:userId` | Admin: staff detail |

### Enhanced Existing Endpoints

- `GET /api/leads` — auto-filter by role
- `POST /api/leads` — staff creates -> auto-assign to self
- `GET /api/leads/stats` — staff sees only own stats
- `PATCH /api/leads/:id/assign` — sends notification to assignee
- All staff endpoints enforce `assigned_to = currentUser` ownership check

### Security Rules

- Staff cannot view/edit leads not assigned to them (403)
- Staff cannot reassign leads (admin-only)
- Staff cannot delete leads (admin-only)
- Staff can change status of own leads (except conversion — needs `leads.convert`)

## Notification System

| Event | Message | Channel |
|-------|---------|---------|
| Lead assigned | "New lead assigned: {name}" | In-app + Push + Socket.io |
| Follow-up due today (8 AM) | "You have {n} follow-ups today" | In-app + Push |
| Follow-up overdue | "Overdue: {lead_name} was due {date}" | In-app |
| Lead converted | "Congrats! {lead_name} converted" | In-app |
| Lead reassigned away | "Lead {name} reassigned to {other}" | In-app |

Uses existing `notification-service.js` + Socket.io rooms (`user_${id}`).

## Admin Leaderboard (New Tab in `admin-leads.html`)

### Metrics Per Staff

- Total leads assigned
- New leads added (self-created)
- Leads converted (won)
- Conversion rate %
- Total follow-ups logged
- Avg follow-ups per lead
- Avg response time (first followup after assignment)
- Active leads count
- Overdue follow-ups count

### UI

New tab "Staff Performance" in admin-leads.html with:
- Date range filter (this month default)
- Ranked table with all metrics
- Click-to-expand detail for each staff member

## Navigation & Permissions

### Staff Sidebar

"My Leads" entry added to staff sidebar, accessible to all staff with `leads.own.view`

### New Permissions

| Permission | Description |
|------------|-------------|
| `leads.own.view` | Staff sees own leads (default for all staff) |
| `leads.own.add` | Staff can create leads |
| `leads.own.edit` | Staff can update own leads + log followups |

Existing `leads.view/edit/delete/convert` remain for admin-level access.

### Migration

- `migrate-staff-leads-permissions.js`: Add `leads.own.view`, `leads.own.add`, `leads.own.edit` to role_permissions for staff role

## No New Tables

All required data exists in:
- `leads` (assigned_to, branch_id, created_by)
- `lead_followups` (user_id, lead_id)
- `ai_lead_scores` (lead_id, score)
- `notifications` (existing table)
