# Staff & Admin Mobile UX Upgrade — Design Spec

**Date:** 2026-04-17  
**Status:** Approved  
**Build order:** All 3 sub-projects in parallel

---

## Overview

Three parallel sub-projects to make staff and admin pages fully mobile-friendly and add Painter Program integration into the staff lead workflow.

---

## Sub-project 1: `staff-painter-marketing.html` — Full Mobile Rewrite

### Problem
Current file is 186 lines with a fixed `max-width: 720px` container, no sidebar nav, not mobile-optimized. Staff use this daily on mobile to call painters.

### Solution
Complete rewrite as a proper staff page (~300 lines).

### Layout & Structure
- Load: Tailwind CSS + `/css/design-system.css` + staff sidebar (same pattern as `staff-leads.html`)
- Sticky header bar: "Today's Painter Calls" title + progress badge (e.g. "5/12")
- Animated progress bar (green fill, `#1B5E3B`)
- Filter pills: All / Pending / Done (existing filter logic preserved)

### Lead Card Design (Action-First)
Each painter lead renders as a card with:
- **Top row:** `full_name` (bold) + status badge (colored by status)
- **Second row:** phone number + last contact info (days ago + outcome)
- **Notes line:** italic, shown only if present
- **3-column button grid:**
  - 📞 Call — `<a href="tel:...">`, green background (`#1B5E3B`)
  - 💬 WA — `<a href="https://wa.me/91...">`, WhatsApp green (`#25d366`)
  - ✏️ Log — outline button, opens Log Outcome modal
- **"Interested" callout strip:** shown when `status === 'interested'`; contains "Convert to Painter →" button

### Log Outcome Modal
Existing bottom-sheet modal preserved as-is (channel, call status, outcome, callback date, notes).

### Convert Flow
Existing `confirm()` dialog → `POST /api/painter-marketing/leads/:id/convert`. No changes.

### APIs Used (no changes needed)
- `GET /api/painter-marketing/me/today`
- `POST /api/painter-marketing/leads/:id/followup`
- `POST /api/painter-marketing/leads/:id/convert`

---

## Sub-project 2: `staff-leads.html` — Painter Program Nomination Button

### Problem
Staff can see leads but cannot nominate them to the Painter Program without going to admin. Need an in-context flow.

### Solution
Add paint roller icon button to each lead card + lightweight nomination modal.

### Button
- Shown on each lead card when `lead.lead_type !== 'painter'`
- Label: `[paint-roller SVG icon] Painter` (16px inline SVG, no icon library needed)
- When already nominated: replaced with non-clickable `✓ Painter` green badge
- Placement: in the existing action buttons row of each lead card

### Nomination Modal
- Trigger: click paint roller button
- Style: bottom-sheet on mobile (`align-items: flex-end`), centered on desktop — matches existing modal pattern in file
- Content:
  - Lead name + phone (read-only display)
  - Notes field (optional, textarea)
  - Confirm button
- On confirm: `POST /api/painter-marketing/admin/leads/from-lead` with `{ lead_id, notes }`
- On success: button → `✓ Painter` badge + toast notification
- On "Already in queue" error: show inline message, don't throw alert

### API
- The existing `POST /api/painter-marketing/admin/leads/from-lead` uses `requirePermission('painters', 'marketing_manage')` — staff tokens cannot call it.
- **Backend change required:** Add a new staff endpoint in `routes/painter-marketing.js`:
  - `POST /api/painter-marketing/staff/leads/from-lead`
  - Auth: `requireAuth` only (any logged-in staff user)
  - Body: `{ lead_id, notes }`
  - Logic: same as admin endpoint — inserts into `painter_leads` pool, returns `{ success, message }`

---

## Sub-project 3: Admin Mobile Audit — Deeper Responsive Work

### Approach
On screens `< md` (768px): hide data tables, show stacked card views. On `>= md`: show tables as normal. Pattern: `hidden md:table-*` on table elements, `md:hidden` on card containers. Tailwind already loaded on all 3 files.

### `admin-leads.html`
- Leads table (`<768px`): hidden; replaced by card per lead showing:
  - Name, status badge, phone, assigned staff name, created date
  - Action buttons: View detail, 🖌️ Painter nomination button (triggers existing modal)
- Nomination modal: ensure `max-width: 100%; width: calc(100% - 2rem)` on mobile, bottom-sheet positioning

### `admin-painters.html` — Marketing Tab
- All Leads subtab table (`<768px`): hidden; replaced by card per painter lead:
  - Painter name, phone, status badge, last contact info
  - Log / Convert action buttons
- Slide panel (detail view): on mobile becomes full-screen bottom sheet (`position: fixed; inset: 0; border-radius: 1rem 1rem 0 0`) instead of side panel

### `staff-billing.html`
- Invoices table (`<768px`): hidden; replaced by card per invoice:
  - Customer name, invoice amount (bold), status badge, date
  - View button
- No new API calls — purely HTML/CSS responsive changes

---

## Shared Patterns

- **Colors:** Staff pages use `#1B5E3B` primary, `#f0fdf4` body bg. Admin pages use `#667eea` primary.
- **Mobile breakpoint:** `768px` (Tailwind `md:`)
- **Modal style:** bottom-sheet on mobile (`align-items: flex-end`, `border-radius: 1rem 1rem 0 0`), centered on desktop (`>=640px`)
- **Backend change:** Sub-project 2 adds one new endpoint (`POST /api/painter-marketing/staff/leads/from-lead`). Sub-projects 1 and 3 have no backend changes.

---

## Files Changed

| File | Change Type |
|------|-------------|
| `public/staff-painter-marketing.html` | Full rewrite |
| `public/staff-leads.html` | Add paint roller button + nomination modal |
| `public/admin-leads.html` | Mobile card view + modal responsive fix |
| `public/admin-painters.html` | Marketing tab mobile card view + slide panel mobile |
| `public/staff-billing.html` | Mobile card view for invoices table |

---

## Out of Scope
- No backend API changes
- No new database tables
- No changes to `staff-requests.html`, `staff-daily-work.html`, `staff-incentives.html`
