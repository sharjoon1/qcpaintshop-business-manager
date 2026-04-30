# WhatsApp Module — Standalone Sidebar Menu

**Date:** 2026-04-03
**Status:** Approved

## Overview

Extract all WhatsApp features from Zoho submenu and Marketing sidebar into a dedicated WhatsApp menu in the admin sidebar. Add new pages for Contacts (with groups/segments), Templates, Admin Login, Dashboard, and Settings.

## Sidebar Structure

Position: After Marketing, before Zoho.

```
WhatsApp
  ├── Dashboard       → /admin-wa-dashboard.html
  ├── Chat            → /admin-whatsapp-chat.html (existing)
  ├── Contacts        → /admin-wa-contacts.html (new)
  ├── Campaigns       → /admin-wa-marketing.html (existing)
  ├── Templates       → /admin-wa-templates.html (new)
  ├── Sessions        → /admin-whatsapp-sessions.html (existing)
  ├── Admin Login     → /admin-wa-admin-login.html (new)
  └── Settings        → /admin-wa-settings.html (new)
```

## Navigation Changes

### sidebar-complete.html
- Add WhatsApp section with icon (fa-brands fa-whatsapp) after Marketing
- Remove "WA Marketing" from Marketing section
- All items: `data-roles="admin"`

### zoho-subnav.html
- Remove "WhatsApp" (sessions) and "WA Chat" entries

### New: components/whatsapp-subnav.html
- Subnav bar for all WhatsApp pages
- Tabs: Dashboard | Chat | Contacts | Campaigns | Templates | Sessions | Admin Login | Settings
- Each tab maps to its page with `data-page` attribute

### universal-nav-loader.js
- Add `WHATSAPP_SUBNAV_PATH` constant
- Add WhatsApp page mappings to `SUBNAV_MAP`:
  - `wa-dashboard`, `whatsapp-chat`, `wa-contacts`, `wa-marketing`, `wa-templates`, `whatsapp-sessions`, `wa-admin-login`, `wa-settings`

### Existing pages to update
- `admin-whatsapp-chat.html`: change `data-page` to `whatsapp-chat`
- `admin-whatsapp-sessions.html`: change `data-page` to `whatsapp-sessions`
- `admin-wa-marketing.html`: change `data-page` to `wa-marketing`

## New Pages

### 1. Dashboard (admin-wa-dashboard.html)
- **data-page:** `wa-dashboard`
- KPI cards: Total contacts, Messages today (in/out), Active campaigns, Connected sessions
- Recent activity feed (last 20 messages)
- Campaign performance mini-chart (last 7 days)
- Session status overview (connected/disconnected per branch)
- Uses existing endpoints: `/api/whatsapp-chat/stats`, `/api/wa-marketing/stats`

### 2. Contacts (admin-wa-contacts.html)
- **data-page:** `wa-contacts`
- **Tab 1: All Contacts**
  - Table: name, phone, groups, last message, unread count, source
  - Search by name/phone
  - Bulk actions: add to group, remove from group
  - Import from leads/customers (modal with filter)
  - Manual add contact
- **Tab 2: Groups**
  - Group list with member count
  - Create/edit/delete groups
  - Group detail: member list with add/remove
  - Predefined suggested groups: VIP, New Customers, Painters, Inactive

### 3. Templates (admin-wa-templates.html)
- **data-page:** `wa-templates`
- Template list with category filter (greeting, promotion, followup, announcement, festival, custom)
- Create/edit modal: name, category, message type (text/image/document), message body with variable insertion buttons ({name}, {company}, {city}, etc.), media upload
- Preview panel showing rendered template
- Usage stats per template
- Uses existing endpoints: `/api/wa-marketing/templates/*`

### 4. Admin Login (admin-wa-admin-login.html)
- **data-page:** `wa-admin-login`
- QR code scanner for admin's personal WhatsApp
- Connection status display
- Test message sending
- Disconnect button
- Uses branch_id = -1 to distinguish from branch sessions

### 5. Settings (admin-wa-settings.html)
- **data-page:** `wa-settings`
- **Section 1: General** — Default branch for sending, message retention days
- **Section 2: Campaign Limits** — Hourly/daily limits, min/max delays, warm-up settings (from wa_marketing_settings)
- **Section 3: Notifications** — Enable/disable new message notifications
- Uses existing endpoints: `/api/wa-marketing/settings`

## Backend Changes

### New Route: routes/wa-contacts.js
Mount: `/api/wa-contacts`

Endpoints:
- `GET /` — List contacts (paginated, search, filter by group)
- `POST /` — Create contact manually
- `PUT /:phone` — Update contact details
- `DELETE /:phone` — Delete contact
- `POST /import` — Import from leads/customers (body: { source: 'leads'|'customers', filters })
- `GET /groups` — List all groups
- `POST /groups` — Create group
- `PUT /groups/:id` — Update group
- `DELETE /groups/:id` — Delete group
- `GET /groups/:id/members` — List group members
- `POST /groups/:id/members` — Add members (body: { phones: [] })
- `DELETE /groups/:id/members` — Remove members (body: { phones: [] })

### New Migration: migrations/migrate-wa-contact-groups.js

```sql
CREATE TABLE wa_contact_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  color VARCHAR(7) DEFAULT '#6366F1',
  member_count INT DEFAULT 0,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wa_contact_group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  phone VARCHAR(50) NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_group_phone (group_id, phone),
  FOREIGN KEY (group_id) REFERENCES wa_contact_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### whatsapp-session-manager.js Changes
- Support `branch_id = -1` for admin session
- Store admin session in `whatsapp_sessions` with branch_id = -1
- Admin session label: "Admin WhatsApp"

### server.js Changes
- Add route mount: `app.use('/api/wa-contacts', require('./routes/wa-contacts'))`
- No changes to existing route mounts

### Permissions
New permission group `whatsapp`:
- `whatsapp.dashboard` — View WhatsApp dashboard
- `whatsapp.chat` — View and reply to chats
- `whatsapp.contacts` — Manage contacts and groups
- `whatsapp.campaigns` — Manage marketing campaigns
- `whatsapp.templates` — Manage message templates
- `whatsapp.sessions` — Manage branch sessions
- `whatsapp.admin_login` — Admin WhatsApp login
- `whatsapp.settings` — Manage WhatsApp settings

Existing permissions (`zoho.whatsapp_sessions`, `zoho.whatsapp_chat`, `marketing.view`, `marketing.manage`) remain as fallback aliases.

## Design System
- All new pages follow existing admin design system (design-system.css)
- Admin brand colors: primary #667eea, gradient to #764ba2, accent #6366F1
- WhatsApp accent: #25D366 (WhatsApp green) for status indicators and WhatsApp-specific elements
- Sidebar icon: WhatsApp brand icon (fa-brands fa-whatsapp) in #25D366

## File List

### New Files
1. `public/admin-wa-dashboard.html`
2. `public/admin-wa-contacts.html`
3. `public/admin-wa-templates.html`
4. `public/admin-wa-admin-login.html`
5. `public/admin-wa-settings.html`
6. `public/components/whatsapp-subnav.html`
7. `routes/wa-contacts.js`
8. `migrations/migrate-wa-contact-groups.js`

### Modified Files
1. `public/components/sidebar-complete.html` — Add WhatsApp section, remove WA from Marketing
2. `public/components/zoho-subnav.html` — Remove WhatsApp entries
3. `public/universal-nav-loader.js` — Add WhatsApp subnav mapping
4. `public/admin-whatsapp-chat.html` — Update data-page
5. `public/admin-whatsapp-sessions.html` — Update data-page
6. `public/admin-wa-marketing.html` — Update data-page
7. `services/whatsapp-session-manager.js` — Support admin session (branch_id = -1)
8. `server.js` — Mount wa-contacts route
