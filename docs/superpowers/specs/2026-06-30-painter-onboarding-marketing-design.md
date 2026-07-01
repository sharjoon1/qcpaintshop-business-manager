# Painter Onboarding & Marketing Workflow — Design Spec

**Date:** 2026-06-30  
**Status:** Approved by product owner  
**Scope:** Painter-only (`act.qcpaintshop.com` backend + web panels). Android app changes are deferred to Phase 2 unless explicitly noted.

## 1. Goal

Enable staff to proactively acquire, market, and onboard painters into the Quality Colours Painter Program from the web panel, while keeping the existing self-registration flow in the Android app. Existing Zoho Books customers who become painters should be auto-linked (no duplicate contacts), and the inviting staff member should be able to approve the painters they recruited.

## 2. Context

- The `painters` table and self-registration flow already exist (`routes/painters/public.js`).
- A `painter_leads` table, `painter_lead_followups`, `painter_daily_assignments`, `painter_zoho_sync_queue`, and related tables already exist (`migrations/migrate-pntr-painter-marketing.js`).
- Existing `zoho_customers_map` links local customers to Zoho contacts by phone/email.
- Staff already have a `staff-painter-marketing.html` page, but it is currently a call list for generic painter marketing, not a structured lead-to-painter onboarding funnel.
- Permission system is module/action based (`middleware/permissionMiddleware.js`, `routes/roles.js`).

## 3. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data model | Extend existing `painter_leads` schema | Table already exists; avoids migration risk and duplicated effort. |
| Sales lead vs painter lead | Keep separate tables | Painter onboarding has a different lifecycle (market → invite → register → approve → activate) than sales leads. Optional `source_lead_id` allows linking. |
| Zoho linkage | Auto-link by last 10 digits of phone; update existing contact | Prevents duplicate Zoho contacts for existing customers who become painters. |
| Staff workflow | Lead-first: collect → follow up → send invite → self-register → staff approve | Matches how field staff actually work; avoids impersonation and OTP misuse. |
| Lead assignment | Manager/admin assigns leads to staff | Gives branch manager control over workload distribution. |
| Approval | Inviting staff can approve their own invited painters; admin/manager can approve any | Incentivizes staff ownership while preserving oversight. |
| Invite channel | Dedicated painter invite endpoint with WhatsApp primary + SMS fallback | Reuses existing WhatsApp session manager; reliable delivery. |
| Panels | New admin painter-leads panel + upgrade existing staff-painter-marketing page | Admin needs assignment/visibility; staff needs mobile-friendly actions. |
| Android | No changes in Phase 1 | Keep scope tight; token/deep-link pre-fill added in Phase 2. |

## 4. Data Model

### 4.1 Extend `painter_leads`

```sql
ALTER TABLE painter_leads
  MODIFY COLUMN status ENUM(
    'new','in_progress','interested','invited','registered','converted','active_painter',
    'not_interested','unreachable','wrong_number','duplicate','snoozed'
  ) DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS source ENUM('zoho_import','staff_walk_in','staff_referral','painter_referral','admin_bulk') DEFAULT 'staff_walk_in',
  ADD COLUMN IF NOT EXISTS source_lead_id INT NULL,
  ADD COLUMN IF NOT EXISTS created_by INT NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS invited_by INT NULL,
  ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64) NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS approved_by INT NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS zoho_contact_id VARCHAR(50) NULL,
  ADD INDEX idx_invite_token (invite_token),
  ADD INDEX idx_created_by (created_by),
  ADD INDEX idx_invited_by (invited_by);
```

Status semantics (extended from the existing ENUM):

- `new` — imported or manually added, not yet contacted
- `in_progress` — staff has started follow-up
- `interested` — painter wants to join
- `invited` — invite link/message sent
- `invited` — invite link/message sent
- `registered` — painter has self-registered (painter_id set)
- `converted` — legacy synonym kept for existing rows; new flow uses `registered`
- `active_painter` — approved/activated
- `not_interested`, `unreachable`, `wrong_number`, `duplicate`, `snoozed` — terminal/disposition states

### 4.2 New `painter_lead_invites`

```sql
CREATE TABLE painter_lead_invites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_lead_id INT NOT NULL,
  sent_by INT NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  channel ENUM('whatsapp','sms') NOT NULL,
  message TEXT NOT NULL,
  invite_token VARCHAR(64) NOT NULL,
  clicked_at TIMESTAMP NULL,
  registered_at TIMESTAMP NULL,
  status ENUM('sent','delivered','clicked','registered','failed') DEFAULT 'sent',
  INDEX idx_lead (painter_lead_id),
  INDEX idx_token (invite_token)
);
```

### 4.3 Extend `painters`

```sql
ALTER TABLE painters
  ADD COLUMN IF NOT EXISTS painter_lead_id INT NULL,
  ADD COLUMN IF NOT EXISTS invited_by_staff_id INT NULL,
  ADD INDEX idx_painter_lead (painter_lead_id);
```

`zoho_contact_id` and `source_lead_id` already exist on `painters`.

### 4.4 Extend `painter_lead_followups`

```sql
ALTER TABLE painter_lead_followups
  MODIFY COLUMN followup_type ENUM('call','whatsapp','visit','sms') NOT NULL;
```

- Use `notes` + `outcome` for invite-related follow-ups where appropriate, or rely on `painter_lead_invites` for strict invite audit.

## 5. API Endpoints

New route file: `routes/painter-leads.js` mounted at `/api/painter-leads` in `server.js`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/painter-leads` | `painter_leads.view` | List all leads with filters/status counts |
| GET | `/api/painter-leads/stats` | `painter_leads.view` | Funnel counts |
| GET | `/api/painter-leads/:id` | `painter_leads.view` | Detail + followups + invites |
| POST | `/api/painter-leads` | `painter_leads.add` | Create lead |
| PUT | `/api/painter-leads/:id` | owner or `painter_leads.manage` | Update lead |
| POST | `/api/painter-leads/:id/assign` | `painter_leads.assign` | Assign to staff |
| POST | `/api/painter-leads/:id/followup` | owner | Log call/WhatsApp/visit/SMS |
| POST | `/api/painter-leads/:id/send-invite` | owner | Send WhatsApp/SMS invite |
| GET | `/api/painter-leads/my` | `painter_leads.own.view` | Staff's assigned leads |
| GET | `/api/painter-leads/my/today` | `painter_leads.own.view` | Today's follow-ups |

### 5.1 Modified painter endpoints

- `POST /api/painters/register`
  - Accept optional `invite_token`.
  - Validate token against `painter_leads`.
  - Set `painters.painter_lead_id`, `painters.invited_by_staff_id`, `painter_leads.painter_id`, and move lead status to `converted`/`registered`.
  - Zoho contact auto-link by phone before creating a new contact.
- `POST /api/painters/:id/activate` / approve flow in `routes/painters/admin.js`
  - Allow if caller is admin/manager OR has `painters.approve` permission AND `painter.invited_by_staff_id === caller.id`.
  - Set `approved_by`, `approved_at` on both `painters` and `painter_leads`.
  - Trigger `painterZohoSync` + `painter-points-backfill`.

### 5.2 Key backend rules

- Duplicate active phone in `painter_leads`: reject creation with existing lead reference.
- WhatsApp session offline: queue SMS fallback, mark invite `failed` but allow retry.
- Zoho API failure: do not block registration; enqueue `painter_zoho_sync_queue`.

## 6. UI

### 6.1 Staff page — upgrade `public/staff-painter-marketing.html`

- Mobile-first card list of assigned painter leads.
- Filter chips: `All`, `Today`, `Pending`, `Interested`, `Invited`, `Registered`.
- Lead card actions:
  - Call (`tel:`)
  - WhatsApp (`wa.me` + auto-log)
  - Log Followup (modal: type, call status, outcome, notes, next date)
  - Send Invite (only when status allows)
  - Approve (only when painter has registered)
- Send Invite modal shows message preview, channel toggle, and sends via dedicated endpoint.

### 6.2 Admin page — new `public/admin-painter-leads.html`

- Funnel stat cards: New, Contacted, Interested, Invited, Registered, Approved.
- Unassigned pool table with bulk/single assignment to staff by branch.
- Staff performance table: assigned, contacted, invited, registered, approved, conversion %.
- Filters: branch, status, date range, assigned staff, phone/name search.

### 6.3 Android

- No UI changes in Phase 1.
- Optional Phase 2: accept `invite_token` from a shared link / Play Store referrer and pre-fill registration.

## 7. Role & Permission Changes

New migration inserts:

| module | action | display_name | default roles |
|---|---|---|---|
| `painter_leads` | `view` | View all painter leads | admin, manager |
| `painter_leads` | `manage` | Manage painter leads | admin, manager |
| `painter_leads` | `add` | Add painter lead | admin, manager, staff |
| `painter_leads` | `assign` | Assign painter leads | admin, manager |
| `painter_leads` | `own.view` | View own painter leads | staff |
| `painter_leads` | `own.edit` | Edit own painter leads | staff |
| `painters` | `approve` | Approve invited painters | staff, admin, manager |

Use a new `ensurePainterLeadPermissions(dbPool)` helper (mirroring `ensureZohoPermissions`) to:
1. Insert permissions into `permissions`.
2. Auto-assign `painter_leads.*` and `painters.approve` to the `admin` role.
3. Auto-assign `painter_leads.add`, `painter_leads.own.view`, `painter_leads.own.edit`, and `painters.approve` to the `staff` role.
4. Auto-assign all `painter_leads.*` and `painters.approve` to the `manager` role.

Call this helper from `routes/painter-leads/index.js` `setPool()` so existing databases auto-heal on deploy.

## 8. Zoho Sync Integration

### 8.1 Auto-link on registration

1. After local `painters` INSERT, query `zoho_customers_map`:
   ```sql
   SELECT zoho_contact_id FROM zoho_customers_map
   WHERE RIGHT(zoho_phone,10) = RIGHT(?,10) LIMIT 1
   ```
2. If match:
   - `UPDATE painters SET zoho_contact_id = ?`
   - `UPDATE painter_leads SET zoho_contact_id = ?, painter_id = ?`
   - Call Zoho `updateContact` to set `cf_painter = true` and optionally assign salesperson.
3. If no match:
   - Proceed with existing `painterZohoSync` create-contact flow.
4. On failure, enqueue `painter_zoho_sync_queue`.

### 8.2 Approval sync

- Approval endpoint calls `painterZohoSync.syncPainterToZoho` and then `painter-points-backfill-service.backfillPainter`.

## 9. Testing & Success Criteria

### 9.1 New/extended tests

| Layer | File | Coverage |
|---|---|---|
| API unit | `tests/unit/painter-leads.test.js` | CRUD, assignment, followup, invite, duplicate phone |
| Auth | extend `tests/unit/auth-middleware.test.js` | New permission gates |
| Zoho | extend `tests/unit/painter-zoho-sync.test.js` | Auto-link, update existing, queue on failure |
| UI smoke | `tests/integration/painter-leads-ui.test.js` | Admin/staff pages load, invite modal opens |

### 9.2 Success criteria

1. Staff can create a `painter_lead`; manager can assign it.
2. Staff can log followups and send WhatsApp/SMS invite.
3. Painter registering with `invite_token` links to the lead and sets `invited_by_staff_id`.
4. Phone matching an existing Zoho customer reuses that contact (no duplicate).
5. Inviting staff can approve registered painter; admin/manager can approve any.
6. Approval triggers Zoho sync + points backfill.
7. Admin dashboard shows funnel stats and unassigned pool.
8. Staff mobile page shows only assigned leads with actions.
9. `npm test` and `npm run lint` pass.
10. No regression in release build; debug build remains blocked by pre-existing `google-services.json` issue.

## 10. Out-of-Scope (Phase 2 or separate ferments)

- Android deep-link invite with pre-filled token.
- In-app painter referral rewards upgrade.
- AI scoring for painter leads.
- Branch stock / Zoho stock reconciliation.
- Graphify integration (to be evaluated separately; not part of this feature).

## 11. Migration File

New migration: `migrations/migrate-painter-leads-onboarding.js` — runs the `ALTER TABLE` statements, creates `painter_lead_invites`, extends `painter_lead_followups`, extends `painters`, and seeds permissions.

## 12. Open Questions

None remaining after owner clarification. This spec is ready for implementation planning.
