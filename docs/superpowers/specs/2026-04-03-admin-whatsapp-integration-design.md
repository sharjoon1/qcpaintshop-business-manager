# Admin WhatsApp Integration — Quick Send + Chat + Campaigns

**Date:** 2026-04-03
**Status:** Approved

## Overview

Enable Admin WhatsApp (branch_id = -1) to be used across the application: quick-send contextual messages from any page, view/reply in Chat, and use as campaign send source.

## 1. Universal Quick Send Modal

A reusable JS component loadable on any page.

### Component: `public/js/wa-quick-send.js`

Self-contained module that injects modal HTML and handles send logic.

**API:**
```js
// Open modal with context
WaQuickSend.open({
    to: '+919876543210',       // pre-filled phone (optional)
    toName: 'Manikandan',     // display name (optional)
    message: 'Pre-filled msg', // pre-filled message (optional)
    context: 'collections',    // source page identifier
    recipientType: 'staff'     // 'staff' | 'customer' | null (show chooser)
});
```

**Modal UI:**
1. **Recipient Type** toggle: Staff / Customer
2. **To** field:
   - Staff mode: searchable dropdown of all staff (from `/api/users?role=staff,manager,admin`) showing name + phone
   - Customer mode: phone input (pre-filled if available)
3. **Message** textarea (pre-filled, editable)
4. **Character count** indicator
5. **Send button** (gradient primary)
6. **Status**: sending spinner, success checkmark, error message

**Styles:** Inline in the JS file (no separate CSS needed — follows project pattern of self-contained components).

### Backend Endpoint

`POST /api/whatsapp-chat/quick-send` (add to `routes/whatsapp-chat.js`)

```
Body: {
    phone: string,        // recipient phone number
    message: string,      // message text
    context: string       // 'collections' | 'leads' | 'manual' etc.
}
```

Logic:
1. Find Admin session (branch_id = -1) in session manager
2. If not connected, try General session (branch_id = 0) as fallback
3. Send message via `sessionManager.sendMessage(branchId, phone, message)`
4. Log to `whatsapp_messages` table with `source: 'admin_quick_send'`, `branch_id: -1`
5. Return `{ success, message }`

Permission: `whatsapp.chat` or admin role.

## 2. Integration Points

### A. Collections Page (`admin-zoho-collections.html`)

Add WhatsApp icon button in two places:

**Customer row** — small WhatsApp icon next to customer name.
- Click opens modal with:
  - `recipientType: 'staff'`
  - `to`: branch staff phone (auto-selected based on customer's branch)
  - `message`: `"Hi {staffName}, Customer: {customerName} has ₹{outstanding} outstanding ({overdueCount} invoices overdue). Please follow up and collect."`

**Invoice row** — WhatsApp icon in actions column.
- Click opens modal with:
  - `recipientType: 'staff'`
  - `to`: branch staff phone
  - `message`: `"Hi {staffName}, Invoice {invoiceNo} for {customerName} - ₹{balance} pending since {date}. Please collect."`

**Also "Send to Customer" option** — toggle to customer mode:
  - `to`: customer phone from `zoho_customers_map`
  - `message`: `"Dear {customerName}, this is a reminder that ₹{outstanding} is pending. Please arrange payment at the earliest. - Quality Colours"`

### B. Leads Page (`admin-leads.html` or equivalent)

WhatsApp icon on each lead row.
- Click opens modal with:
  - `recipientType: null` (show chooser — Staff or Customer)
  - Staff mode message: `"Hi {staffName}, Please check lead: {leadName}, Phone: {phone}, Source: {source}, Status: {status}. Follow up required."`
  - Customer/Lead mode message: `"Hi {leadName}, Thank you for your interest in Quality Colours. We'd like to help you with your paint requirements. - Quality Colours"`

### C. Chat Page (`admin-whatsapp-chat.html`)

- Add "Admin" option in branch filter/tabs
- When "Admin" selected, load conversations where `branch_id = -1`
- Reply sends via Admin session
- Existing conversations endpoint already supports branch_id filter — just need UI change

### D. Campaigns Page (`admin-wa-marketing.html`)

- Add "Send from" dropdown in campaign create/edit form
- Options: "General WhatsApp" (branch_id=0), "Admin WhatsApp" (branch_id=-1), plus any connected branch sessions
- Campaign engine uses selected branch_id's session to send
- Store `send_from_branch_id` in `wa_campaigns` table (default 0)

## 3. Backend Changes

### routes/whatsapp-chat.js
- Add `POST /quick-send` endpoint (before `/:phone` routes)
- Add `source` value `'admin_quick_send'` to message logging

### routes/wa-marketing.js (campaigns)
- Update campaign create/update to accept `send_from_branch_id`
- Update campaign engine to use specified branch session

### Migration
- `ALTER TABLE wa_campaigns ADD COLUMN send_from_branch_id INT DEFAULT 0` — which session to send from

## 4. Staff Phone Directory

Quick-send needs staff phone numbers. Use existing `/api/users` endpoint with role filter. The `users` table has `phone` column.

Response shape needed: `{ id, full_name, phone, role, branch_id }`

## 5. Message Templates

Pre-filled messages per context. Stored as JS constants in `wa-quick-send.js`:

```js
const TEMPLATES = {
    collections_customer: "Hi {staffName}, Customer: {customerName} has ₹{outstanding} outstanding ({overdueCount} invoices overdue). Please follow up and collect.",
    collections_customer_direct: "Dear {customerName}, this is a reminder that ₹{outstanding} is pending. Please arrange payment at the earliest. - Quality Colours",
    collections_invoice: "Hi {staffName}, Invoice {invoiceNo} for {customerName} - ₹{balance} pending since {date}. Please collect.",
    collections_invoice_direct: "Dear {customerName}, your invoice {invoiceNo} of ₹{balance} is pending since {date}. Kindly arrange payment. - Quality Colours",
    leads_staff: "Hi {staffName}, Please check lead: {leadName}, Phone: {phone}, Source: {source}, Status: {status}. Follow up required.",
    leads_direct: "Hi {leadName}, Thank you for your interest in Quality Colours. We'd like to help you with your paint requirements. - Quality Colours"
};
```

Variables replaced at modal open time from the context data passed to `WaQuickSend.open()`.

## 6. File Summary

### New Files
1. `public/js/wa-quick-send.js` — Reusable modal component + templates + send logic
2. `migrations/migrate-wa-campaign-send-from.js` — Add send_from_branch_id to wa_campaigns

### Modified Files
1. `routes/whatsapp-chat.js` — Add POST /quick-send endpoint
2. `public/admin-zoho-collections.html` — Add WA icon buttons on customer/invoice rows
3. `public/admin-whatsapp-chat.html` — Add Admin filter in branch selector
4. `public/admin-wa-marketing.html` — Add "Send from" dropdown in campaign form
5. `routes/wa-marketing.js` — Accept send_from_branch_id in campaign CRUD
6. `services/wa-campaign-engine.js` — Use campaign's send_from_branch_id for sending
7. Leads page — Add WA icon buttons on lead rows
