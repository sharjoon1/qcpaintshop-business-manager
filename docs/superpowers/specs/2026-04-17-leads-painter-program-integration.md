# Leads ↔ Painter Program Integration Design

## Summary

Bridge `admin-leads.html` (customer leads) with the Painter Program (`admin-painters.html` Marketing tab) so that:
1. Staff can nominate any customer lead for the Painter Program directly from admin-leads.html
2. When a painter_lead is converted (staff_convert), the assigned staff earns an incentive
3. Marketing "All Leads" tab shows which painter_leads originated from customer leads

---

## Gap Analysis

| Gap | Current State | Fix |
|-----|--------------|-----|
| 1 | No way to send a customer lead to painter program from admin-leads.html | "Painter Program" button + modal |
| 2 | `POST /painter-marketing/leads/:id/convert` creates painter but ZERO incentive | Add `staff_incentives` INSERT on convert |
| 3 | Marketing All Leads tab has no source column | Add `source_lead_id` badge |

---

## Feature 1: "Painter Program" Button in admin-leads.html

### UI
- In the lead actions area (wherever "Convert", "Follow Up" buttons are), add **"🎨 Painter Program"** button
- Button only shows if lead is NOT already nominated (`lead_type !== 'painter'` OR no linked painter_lead)
- If already nominated: show green badge **"✓ In Marketing Queue"** with link to admin-painters.html?tab=marketing

### Nomination Modal
- Title: "Nominate for Painter Program"
- Branch dropdown (populated from /api/branches)
- Lead name/phone shown (read-only, confirmation)
- "Nominate" button → POST to new endpoint
- On success: badge updates, no page reload needed

### API Call
`POST /api/painter-marketing/admin/leads/from-lead`
- Auth: `requirePermission('painters', 'marketing_manage')`
- Body: `{ lead_id: Number, branch_id: Number }`
- Response: `{ success: true, painter_lead_id: Number }`

---

## Feature 2: New API Endpoint — from-lead

`POST /api/painter-marketing/admin/leads/from-lead`

**Logic:**
1. Fetch lead from `leads` table: `id, name, phone, email, assigned_to`
2. Check duplicate: if `painter_leads` already has same phone → return `{ success: false, error: 'already_exists', painter_lead_id }` (don't create duplicate)
3. INSERT into `painter_leads`:
   - `full_name` = lead.name
   - `phone` = lead.phone (normalize to 10-digit)
   - `email` = lead.email
   - `branch_id` = body.branch_id
   - `branch_detected_via` = 'admin_assign'
   - `assigned_to` = lead.assigned_to (original staff keeps credit)
   - `source_lead_id` = lead.id
   - `status` = 'new'
4. UPDATE `leads` SET `lead_type = 'painter'` WHERE `id = lead_id`
5. Call `assignNewLead(pool, painter_lead_id, branch_id)` to assign to staff queue
6. Return `{ success: true, painter_lead_id }`

**Validation:**
- `lead_id` and `branch_id` required
- Lead must exist
- Phone normalization: strip non-digits, 10-digit only

---

## Feature 3: Incentive on Painter Conversion

**File:** `routes/painter-marketing.js` — `POST /leads/:id/convert`

**After creating painter record and updating painter_lead status, add:**

```
IF painter_lead.assigned_to IS NOT NULL AND incentive_enabled config = 'true':
  1. Get incentive_per_conversion from ai_config (default 500)
  2. Get incentive_auto_approve from ai_config
  3. INSERT staff_incentives:
     - user_id = painter_lead.assigned_to
     - lead_id = painter_lead.source_lead_id (NULL if none)
     - lead_type = 'painter'
     - incentive_month = YYYY-MM of NOW()
     - amount = incentive_per_conversion
     - source = 'painter_convert'
     - status = 'approved' if auto_approve, else 'pending'
     - notes = 'Painter enrolled: {full_name} ({phone})'
```

**Migration required:** ALTER `staff_incentives.source` ENUM to add `'painter_convert'`

---

## Feature 4: Source Badge in Marketing All Leads

**Backend:** `GET /api/painter-marketing/admin/leads`
- Add `pl.source_lead_id` to SELECT
- Add `l2.name AS source_lead_name` via LEFT JOIN `leads l2 ON l2.id = pl.source_lead_id`

**Frontend:** `public/admin-painters.html` All Leads table
- Add "Source" column (hidden on small screens)
- If `source_lead_id`: show `<span class="badge">📋 Customer Lead</span>` — clicking opens `admin-leads.html?highlight={source_lead_id}` in new tab
- If no source_lead_id: show `<span class="text-gray-300">PNTR Zoho</span>`

---

## Migration File

`migrations/migrate-painter-lead-incentive.js`

```sql
ALTER TABLE staff_incentives 
MODIFY COLUMN source ENUM('auto_estimate','manual_request','admin_added','painter_convert') 
DEFAULT 'admin_added';
```

Run with: `node migrate.js`

---

## Constraints

- No new DB tables
- `painter_leads.source_lead_id` already exists (FK to leads.id)
- `leads.lead_type` already has 'painter' in ENUM
- Incentive amount uses existing `incentive_per_conversion` ai_config key
- Phone normalization: strip non-digits → 10 digits only
- Duplicate check by phone before inserting painter_lead
- Do NOT remove `assigned_to` from original lead when nominating — staff keeps both credit paths
