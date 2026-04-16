# Painter Marketing Admin — All Leads + Slide Panel + WhatsApp Send

## Summary

Add three capabilities to the Painter Marketing admin tab (`admin-painters.html`):
1. **All Leads subtab** — view all 289 painter_leads with branch/status/search filters
2. **Lead Slide-out Panel** — click any row → right-side panel with branch assign, manual staff assign, WhatsApp send, contact history
3. **Admin WhatsApp Send** — send via existing system WhatsApp session manager directly from admin

---

## Feature 1: All Leads Subtab

### UI
- New subtab label "All Leads" inserted **before** "Duplicate Phone" in the marketing subtab bar
- Filter bar: Branch dropdown (all active branches + "Unassigned"), Status dropdown (All/New/In Progress/Interested/Converted/Not Interested), Search input (name or phone)
- Table columns: Painter Name, Phone, Branch, Assigned Staff, Status, Last Contact
- Row click → opens Slide Panel for that lead
- Bottom bulk bar: Branch dropdown + Staff dropdown + "Apply to Selected" button (for multi-checkbox bulk assign)
- Badge: total count + unassigned count

### API
`GET /api/painter-marketing/admin/leads`
- Query params: `branch_id` (int|"unassigned"), `status`, `search`, `page` (default 1), `limit` (default 50)
- Returns: `{ success, leads: [...], total, unassigned_count }`
- Lead fields: `id, full_name, phone, branch_id, branch_name, assigned_to, staff_name, status, last_contact_date, total_attempts`
- Auth: `requirePermission('painters', 'marketing_view')`

---

## Feature 2: Lead Slide-out Panel

### UI
- Panel slides in from the right (380px wide), narrows the leads list
- Sections:
  - **Lead Info**: branch name, staff name, total calls, last contact date
  - **Assign**: branch select + staff select (populated by branch) + Save button. Staff list shows only users with `marketing_contact` permission in that branch. "— Auto assign —" option = pick lowest-load staff.
  - **WhatsApp**: 3 template chips (PNTR Welcome / Points Info / Register Link) + Custom chip → textarea → Send button
  - **Contact History**: chronological list of followups from `painter_lead_followups` table (type, outcome, notes, staff name, date)
- Panel closes on ✕ or clicking another row (replaces content)

### APIs
`PUT /api/painter-marketing/admin/leads/:id/assign`
- Body: `{ branch_id, assigned_to }` (`assigned_to` = null means auto)
- Returns: `{ success, assigned_to, staff_name }`
- Auth: `requirePermission('painters', 'marketing_manage')`

`GET /api/painter-marketing/admin/leads/:id/history`
- Returns: `{ success, history: [{ type, outcome, notes, staff_name, created_at }] }`
- Auth: `requirePermission('painters', 'marketing_view')`

`GET /api/painter-marketing/admin/branches/:branch_id/staff`
- Returns staff with `marketing_contact` permission in branch: `{ success, staff: [{ id, full_name }] }`
- Auth: `requirePermission('painters', 'marketing_manage')`

---

## Feature 3: Admin WhatsApp Send

### Templates (hardcoded, no DB)
```
PNTR Welcome:
"{name} அவர்களே, QC Colour Painter Program-ல் உங்களை அழைக்கிறோம். Points சம்பாதித்து பரிசுகள் வெல்லுங்கள். App Download: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter"

Points Info:
"{name} அவர்களே, ஒவ்வொரு purchase-க்கும் Loyalty Points கிடைக்கும். அதை திரும்ப பணமாக பெறலாம். App: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter"

Register Link:
"QC Painter App: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter"
```

### API
`POST /api/painter-marketing/admin/leads/:id/send-wa`
- Body: `{ message }` (final text after template substitution)
- Uses existing `whatsapp-session-manager` → `sendMessage(phone, message)`
- Phone from `painter_leads.phone` — sanitize to `91XXXXXXXXXX` format for WA
- Logs to `painter_lead_followups` as `followup_type='whatsapp'`, `outcome='message_sent'`, `notes=message`
- Returns: `{ success }` or `{ success: false, error }`
- Auth: `requirePermission('painters', 'marketing_manage')`

---

## Constraints
- No new DB tables needed — uses existing `painter_leads`, `painter_lead_followups`, `branches`, `users`, `role_permissions`
- No greeting words: never use வணக்கம், நமஸ்தே, Vanakkam, Namaste in any template
- WhatsApp phone format: strip to 10 digits → prepend `91` → `91XXXXXXXXXX@c.us`
- Staff dropdown only shows users whose branch matches selected branch
- Bulk assign POST `/admin/queues/unassigned/assign` already exists — reuse it for bulk in All Leads tab
