# Admin Painter Management Page — UI/UX Redesign

## Overview

Full redesign of `public/admin-painters.html` to be mobile-first, touch-friendly, and organised into 4 logical groups. All 14 existing tabs are preserved and migrated into the new structure. No backend changes required.

---

## 1. Navigation Architecture

### Group Tab Strip
- 4 equal-width buttons, sticky below page header, 44px touch height
- Groups: **Painters 👥** | **Finance 💰** | **Catalog 📦** | **Comms 📣**
- Active state: `bg-indigo-600 text-white rounded-lg`
- Inactive: `text-gray-600 hover:bg-gray-100`
- Badge on Finance (pending withdrawal count), Comms (attendance anomaly count)

### Sub-tab Strip
- Horizontal-scroll `overflow-x: auto`, no wrapping, sticky below group strip
- Active sub-tab: `border-b-2 border-indigo-600 text-indigo-600`
- Inactive: `text-gray-500`
- Active sub-tab auto-scrolled into view on group switch
- Sub-tab labels: text only (no icons), 14px, 44px touch height

### Tab Mapping

| Group | Sub-tabs (existing tab IDs preserved) |
|-------|----------------------------------------|
| Painters 👥 | Painters, Levels, Attendance |
| Finance 💰 | Withdrawals, Billing, Estimates |
| Catalog 📦 | Products, Offers, Points Config |
| Comms 📣 | Attendance Live, Reports, Marketing |

> Note: Existing `showTab(id)` / `hideTab(id)` JS pattern preserved. Group switch calls `showTab()` on first sub-tab of that group and updates group + sub-tab active states.

### Sticky Behaviour
- Page header (title + breadcrumb): static
- Group strip: `position: sticky; top: 0; z-index: 40`
- Sub-tab strip: `position: sticky; top: 44px; z-index: 39`
- Content area scrolls beneath both strips

---

## 2. Painters Tab — List & Actions

### Layout
- **Mobile**: Full-width cards, stacked vertically
- **Desktop** (`md:` breakpoint): Table with columns — Avatar | Name | Level | Branch | Reg. Points | Ann. Points | Status | Actions

### Mobile Card Anatomy
```
┌─────────────────────────────────────┐
│ [Avatar] Rajan Kumar        [●Active]│
│          Gold • 4,820 pts           │
│          Chennai Branch             │
│  [Edit]  [Points ±]  [More ▾]       │
└─────────────────────────────────────┘
```
- **Avatar**: 40px circle, initials fallback, level-coloured ring
  - Gold: `#D4A24E`, Silver: `#9CA3AF`, Bronze: `#92400E`, Default: `#6366F1`
- **Level badge**: small coloured pill inline with name
- **Points**: `Reg: 4,820 · Ann: 1,200` condensed line
- **Status chip**: Active (green), Inactive (gray), Suspended (red)
- **Actions**: `Edit` + `Points ±` always visible; `More ▾` dropdown for View History, Generate Card, Suspend

### Above-list Controls
- Search bar: full width, always visible, debounced 400ms
- Filter pills row (horizontal scroll on mobile): `All Levels ▾` · `All Branches ▾` · `All Status ▾`
- Sort: `Sort ▾` pill on mobile (dropdown: Name / Points / Date Joined / Level); column header clicks on desktop

### States
- Loading: skeleton cards (3 rows)
- Empty: "No painters found" + "Clear Filters" button

---

## 3. Finance Tab

### 3a. Withdrawals Sub-tab

**Summary strip** (sticky below sub-tab strip):
`Pending: ₹18,400 · This Month Paid: ₹92,000`

**Mobile card**:
```
┌─────────────────────────────────────┐
│ Rajan Kumar          ₹2,500 Regular │
│ Chennai · 21 Apr 2026               │
│ "Need money for materials"          │
│        [Reject]      [Approve]      │
└─────────────────────────────────────┘
```
- Pending requests shown first
- `Approve`: green filled button, 44px height
- `Reject`: red outlined button, 44px height
- Desktop: table — Painter | Amount | Type | Branch | Date | Note | Actions

**Filters**: Date range pill · `All Types ▾` (Regular/Annual) · `All Status ▾` (Pending/Approved/Rejected)

### 3b. Billing Sub-tab
- Invoice cards: Painter name · Invoice # · Amount · Date · Status chip
- Filter pills: `All Types ▾` · `All Status ▾`
- Tap row → existing slide-up/modal with full invoice detail
- Desktop: existing table layout preserved, made responsive

### 3c. Estimates Sub-tab
- Cards matching existing estimates list style
- Status chips: Draft / Pending / Approved / Payment Recorded / Pushed
- Primary CTA per status: e.g., "Confirm Payment" for `payment_submitted`
- Filter: `All Status ▾` · Date range

---

## 4. Catalog Tab

### 4a. Products Sub-tab
- Read-only list: Product name · Brand · Pack sizes count · In-stock chip
- Filter pills: `All Brands ▾` · In-Stock toggle
- "Manage Products →" button opens `admin-products.html` in new tab
- Cards on mobile, table on desktop

### 4b. Offers Sub-tab
- FAB `+ New Offer` (bottom-right, 56px, indigo)
- **Mobile card**:
  ```
  ┌─────────────────────────────────────┐
  │ Asian Paints — Brand Offer   [●Live]│
  │ 21 Apr → 30 Apr 2026                │
  │ "Extra 5% points on all AP orders" │
  │     [Edit]           [End Offer]    │
  └─────────────────────────────────────┘
  ```
- Status chips: Live (green), Scheduled (blue), Ended (gray)
- Offer scope shown inline: Brand / Category / All
- Desktop: table with columns — Name | Scope | Dates | Status | Actions

### 4c. Points Config Sub-tab
- Settings form, full-width on mobile:
  - Regular points rate (per ₹ of invoice)
  - Annual points rate
  - Annual withdrawal window open date (date picker)
  - Referral tier table: editable rows — Bills Threshold → Pct (%) — mobile-friendly inline table
- `Save Config` button: full width on mobile, right-aligned on desktop
- Current values pre-filled from `ai_config` `painter_*` keys
- Save shows confirmation toast

---

## 5. Comms Tab

### 5a. Attendance Sub-tab (Live)
- Summary strip: `In: 12 · Out: 4 · Away: 2`
- Auto-refresh every 60s
- **Mobile card**:
  ```
  ┌─────────────────────────────────────┐
  │ [●] Rajan Kumar         Clocked In  │
  │     Chennai · Since 09:14 AM        │
  │     GPS: Within geofence            │
  └─────────────────────────────────────┘
  ```
- Filter pills: `All Branches ▾` · `All Status ▾` (In / Out / Away)
- Tap card → slide-up sheet: today's clock-in/out log + GPS events

### 5b. Reports Sub-tab
- Report type pills: `Performance` | `Points` | `Referrals`
- Date range: This Month / Last Month / Custom
- Painter metric cards with key stat
- `Export CSV` button (top-right on desktop, full-width below list on mobile)

### 5c. Marketing Sub-tab
- Stats strip: Total Leads · Called · Converted
- Campaign list cards: Name · Sent · Opened · Converted · Date
- `+ New Campaign` FAB
- "Compose Message →" links to WhatsApp module

---

## 6. Shared Patterns

### Responsive Breakpoints
- Mobile: `< 768px` — cards, single-column, full-width buttons
- Desktop: `≥ 768px` — tables, multi-column, inline actions

### Touch Targets
- All interactive elements: minimum 44×44px
- Buttons inside cards: minimum `py-2 px-4`

### Color System
- Follows existing admin brand: primary `#667eea`, gradient to `#764ba2`, accent `#6366F1`
- Status chips use Tailwind semantic colors (green/red/gray/blue)
- Painter level colors: Gold `#D4A24E`, Silver `#9CA3AF`, Bronze `#92400E`

### Loading & Empty States
- Skeleton loaders: 3-card skeleton matching card anatomy
- Empty state: icon + message + contextual action button
- Error state: red banner with retry button

### Modals & Sheets
- Existing modal patterns preserved (Bootstrap or custom)
- On mobile: modals animate up from bottom (sheet style, `rounded-t-2xl`)
- On desktop: centered modal, max-width 600px

### Implementation Notes
- All changes are in `public/admin-painters.html` (single file)
- No backend changes required
- Existing JS functions (`showTab`, `hideTab`, `loadPainters`, etc.) preserved and extended
- Tailwind CSS used for all new styles (already loaded on page)
- New group-switching JS function: `switchGroup(groupName)` updates both strips and calls `showTab()` on first sub-tab
