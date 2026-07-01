# Painter Onboarding & Marketing Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement staff-driven painter onboarding with lead management, WhatsApp/SMS invite, auto-Zoho-link, and staff approval.

**Architecture:** Extend existing `painter_leads` schema and related tables; add a new `routes/painter-leads.js` module; modify painter registration/approval; build an admin dashboard and upgrade the existing staff mobile marketing page.

**Tech Stack:** Node.js 24, Express 5, MySQL/MariaDB via `mysql2/promise`, Tailwind CSS, vanilla JS.

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-painter-leads-onboarding.js`

- [ ] **Step 1.1: Write the migration file**

```javascript
// migrations/migrate-painter-leads-onboarding.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function run() {
  console.log('=== Painter leads onboarding migration ===');

  // 1. Extend painter_leads status ENUM and add onboarding columns
  await pool.query(`
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
      ADD INDEX idx_invited_by (invited_by),
      ADD INDEX idx_source_lead (source_lead_id)
  `);
  console.log('  [1/5] painter_leads extended');

  // 2. Create painter_lead_invites
  await pool.query(`
    CREATE TABLE IF NOT EXISTS painter_lead_invites (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  [2/5] painter_lead_invites created');

  // 3. Extend painter_lead_followups with sms
  await pool.query(`
    ALTER TABLE painter_lead_followups
      MODIFY COLUMN followup_type ENUM('call','whatsapp','visit','sms') NOT NULL
  `);
  console.log('  [3/5] painter_lead_followups extended');

  // 4. Extend painters
  const [[{ exists }]] = await pool.query(`
    SELECT COUNT(*) AS exists FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters'
  `);
  if (exists) {
    await pool.query(`
      ALTER TABLE painters
        ADD COLUMN IF NOT EXISTS painter_lead_id INT NULL,
        ADD COLUMN IF NOT EXISTS invited_by_staff_id INT NULL,
        ADD INDEX idx_painter_lead (painter_lead_id)
    `);
    console.log('  [4/5] painters extended');
  } else {
    console.log('  [4/5] painters table not found — skipped');
  }

  // 5. Seed permissions
  const perms = [
    ['painter_leads','view','View all painter leads'],
    ['painter_leads','manage','Manage painter leads'],
    ['painter_leads','add','Add painter lead'],
    ['painter_leads','assign','Assign painter leads'],
    ['painter_leads','own.view','View own painter leads'],
    ['painter_leads','own.edit','Edit own painter leads'],
    ['painters','approve','Approve invited painters']
  ];
  for (const [mod, act, name] of perms) {
    await pool.query(`
      INSERT INTO permissions (module, action, display_name, description)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
    `, [mod, act, name, name]);
  }
  // Admin gets all
  await pool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'admin'
  `);
  // Manager gets painter_leads.* + painters.approve
  await pool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'manager' AND (p.module = 'painter_leads' OR (p.module='painters' AND p.action='approve'))
  `);
  // Staff gets add/own.view/own.edit + painters.approve
  await pool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'staff' AND (
      (p.module='painter_leads' AND p.action IN ('add','own.view','own.edit')) OR
      (p.module='painters' AND p.action='approve')
    )
  `);
  console.log('  [5/5] permissions seeded');

  console.log('Migration complete');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 1.2: Run the migration locally**

```bash
cd /mnt/d/QUALITY\ COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com
node migrate.js
```

Expected: migration completes without errors; `--status` shows it tracked.

- [ ] **Step 1.3: Verify schema changes**

```bash
node -e "
const { createPool } = require('./config/database');
const pool = createPool();
(async () => {
  const [cols] = await pool.query('SHOW COLUMNS FROM painter_leads');
  console.log(cols.map(c => c.Field).join(', '));
  const [t] = await pool.query('SHOW TABLES LIKE \"painter_lead_invites\"');
  console.log('painter_lead_invites exists:', t.length === 1);
  process.exit(0);
})();
"
```

Expected: `painter_leads` columns include `source`, `invited_by`, `invite_token`, `painter_lead_invites` exists.

- [ ] **Step 1.4: Commit**

```bash
git add migrations/migrate-painter-leads-onboarding.js
git commit -m "feat(painter-onboarding): migration for painter leads onboarding workflow"
```

---

## Task 2: Route Wiring & Permission Helper

**Files:**
- Modify: `server.js` (mount route)
- Create: `routes/painter-leads/index.js`
- Create: `routes/painter-leads/shared.js`

- [ ] **Step 2.1: Create `routes/painter-leads/shared.js` with permission helper**

```javascript
// routes/painter-leads/shared.js
let pool;
function setPool(p) { pool = p; }

async function ensurePainterLeadPermissions(dbPool) {
  const perms = [
    ['painter_leads','view','View all painter leads','View all painter leads'],
    ['painter_leads','manage','Manage painter leads','Manage painter leads'],
    ['painter_leads','add','Add painter lead','Add painter lead'],
    ['painter_leads','assign','Assign painter leads','Assign painter leads'],
    ['painter_leads','own.view','View own painter leads','View own painter leads'],
    ['painter_leads','own.edit','Edit own painter leads','Edit own painter leads'],
    ['painters','approve','Approve invited painters','Approve invited painters']
  ];
  for (const [mod, act, name, desc] of perms) {
    await dbPool.query(`
      INSERT INTO permissions (module, action, display_name, description)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
    `, [mod, act, name, desc]);
  }
  await dbPool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'admin'
  `);
  await dbPool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'manager' AND (p.module = 'painter_leads' OR (p.module='painters' AND p.action='approve'))
  `);
  await dbPool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.name = 'staff' AND (
      (p.module='painter_leads' AND p.action IN ('add','own.view','own.edit')) OR
      (p.module='painters' AND p.action='approve')
    )
  `);
}

module.exports = { setPool, ensurePainterLeadPermissions };
```

- [ ] **Step 2.2: Create `routes/painter-leads/index.js` composition root**

```javascript
// routes/painter-leads/index.js
const express = require('express');
const shared = require('./shared');
const apiRoutes = require('./api');
const router = express.Router();

router.use(apiRoutes.router);

function setPool(p) {
  shared.setPool(p);
  apiRoutes.setPool(p);
  shared.ensurePainterLeadPermissions(p).catch(err => {
    console.log('[painter-leads] permission seed skipped:', err.message);
  });
}

module.exports = { router, setPool };
```

- [ ] **Step 2.3: Mount route in `server.js`**

Add after the other route mounts (around line 430):

```javascript
const painterLeadRoutes = require('./routes/painter-leads');
painterLeadRoutes.setPool(pool);
app.use('/api/painter-leads', painterLeadRoutes.router);
```

- [ ] **Step 2.4: Verify route starts without error**

```bash
npm start &
sleep 5
curl -s http://localhost:3000/api/painter-leads | head -c 200
```

Expected: server starts; unauthenticated request returns 401/403, not 404.

- [ ] **Step 2.5: Commit**

```bash
git add routes/painter-leads/index.js routes/painter-leads/shared.js server.js
git commit -m "feat(painter-onboarding): route wiring and permission helper"
```

---

## Task 3: Painter Lead API Endpoints

**Files:**
- Create: `routes/painter-leads/api.js`

- [ ] **Step 3.1: Implement full CRUD, assignment, followup, invite endpoints**

Create `routes/painter-leads/api.js` implementing the endpoints from the spec. Key implementation notes:

- Use `requirePermission` and `requireAuth` from `../middleware/permissionMiddleware`.
- Reuse the lead-number generator pattern (`PL-YYYYMMDD-XXXX`).
- Owner checks: for endpoints operating on an existing lead, verify `req.user.id === lead.assigned_to` or full admin or `painter_leads.manage`.
- `POST /:id/send-invite`: generate `crypto.randomBytes(32).toString('hex')`, store in `painter_lead_invites`, call WhatsApp session manager with a message containing `https://qcpaintshop.com/painter-register?token=<token>` (or app deep-link placeholder). On failure, send SMS via `smsService`.
- `POST /:id/followup`: insert into `painter_lead_followups`, update `painter_leads.last_contact_date`, `last_outcome`, `next_eligible_date`, `total_attempts`, and optionally status.

- [ ] **Step 3.2: Add unit test scaffold**

Create `tests/unit/painter-leads.test.js` with tests for:
- Manager can create and assign a lead.
- Staff can only view/edit own leads.
- Duplicate phone rejection.
- Followup updates status and counts.

- [ ] **Step 3.3: Run unit tests**

```bash
npm test -- tests/unit/painter-leads.test.js
```

Expected: all new tests pass (TDD: write failing first, then implement).

- [ ] **Step 3.4: Commit**

```bash
git add routes/painter-leads/api.js tests/unit/painter-leads.test.js
git commit -m "feat(painter-onboarding): painter lead API endpoints and tests"
```

---

## Task 4: Modify Painter Registration & Approval

**Files:**
- Modify: `routes/painters/public.js`
- Modify: `routes/painters/admin.js`

- [ ] **Step 4.1: Extend registration to accept invite token and auto-link Zoho**

In `routes/painters/public.js` `POST /register`:
- Accept `invite_token` from body.
- If provided, validate against `painter_leads` where `invite_token = ?` and status in (`interested`, `invited`).
- On successful registration, set `painters.painter_lead_id`, `painters.invited_by_staff_id`, `painter_leads.painter_id`, and update lead status to `registered`.
- After local insert, before calling `painterZohoSync`, query `zoho_customers_map` by last 10 digits of phone.
- If match: update `painters.zoho_contact_id`, `painter_leads.zoho_contact_id`, call `zohoAPI.updateContact` to set custom fields.
- If no match or update fails: enqueue `painter_zoho_sync_queue` and fall through to existing create flow.

- [ ] **Step 4.2: Extend approval to allow inviting staff**

In `routes/painters/admin.js` find the existing approve/activate endpoint:
- Allow if caller is full admin/manager OR has `painters.approve` permission AND `painter.invited_by_staff_id === req.user.id`.
- Set `approved_by`, `approved_at` on `painters` and `painter_leads`.
- Trigger `painterZohoSync.syncPainterToZoho` and `painter-points-backfill-service.backfillPainter`.

- [ ] **Step 4.3: Add/update unit tests**

Extend `tests/unit/painter-zoho-sync.test.js` or create new test for:
- Registration with invite token links lead and staff.
- Existing Zoho phone match sets `zoho_contact_id` without creating duplicate.
- Inviting staff can approve; non-inviting staff cannot.

- [ ] **Step 4.4: Run tests**

```bash
npm test -- tests/unit/painter-zoho-sync.test.js tests/unit/auth-middleware.test.js
```

Expected: pass.

- [ ] **Step 4.5: Commit**

```bash
git add routes/painters/public.js routes/painters/admin.js tests/unit/painter-zoho-sync.test.js
git commit -m "feat(painter-onboarding): invite token, zoho auto-link, staff approval"
```

---

## Task 5: Admin Painter-Leads Dashboard

**Files:**
- Create: `public/admin-painter-leads.html`
- Create: `public/js/pages/admin-painter-leads.js`

- [ ] **Step 5.1: Build admin HTML page**

Reuse existing admin page shell (e.g., `public/admin-painters.html`) with:
- Header: "Painter Lead Management"
- Funnel stat cards
- Unassigned pool table with checkboxes and assign dropdown
- Staff performance table
- Filters row

- [ ] **Step 5.2: Build admin JS**

Fetch endpoints:
- `GET /api/painter-leads/stats`
- `GET /api/painter-leads?status=new&assigned_to=unassigned`
- `GET /api/users?role=staff` (or existing users endpoint) for assign dropdown
- `POST /api/painter-leads/:id/assign`

Render tables and wire bulk/single assignment.

- [ ] **Step 5.3: Smoke test page load**

```bash
npm test -- tests/integration/painter-leads-ui.test.js
```

Expected: admin page loads and shows stats.

- [ ] **Step 5.4: Commit**

```bash
git add public/admin-painter-leads.html public/js/pages/admin-painter-leads.js tests/integration/painter-leads-ui.test.js
git commit -m "feat(painter-onboarding): admin painter leads dashboard"
```

---

## Task 6: Staff Painter Marketing Page Upgrade

**Files:**
- Modify: `public/staff-painter-marketing.html`
- Modify: `public/js/pages/staff-painter-marketing.js`

- [ ] **Step 6.1: Update HTML structure**

Change title/filters to match the new painter lead workflow. Add modal containers for invite and followup. Keep existing CSP-safe pattern.

- [ ] **Step 6.2: Rewrite/extend JS**

- Load from `GET /api/painter-leads/my` and `GET /api/painter-leads/my/today`.
- Render cards with status badges and actions:
  - Call (`tel:`)
  - WhatsApp (`wa.me`)
  - Log Followup → modal → POST `/api/painter-leads/:id/followup`
  - Send Invite → modal → POST `/api/painter-leads/:id/send-invite`
  - Approve → POST `/api/painters/:id/approve` (only if `status === 'registered'`)

- [ ] **Step 6.3: Run integration smoke test**

```bash
npm test -- tests/integration/staff-painter-marketing-ui.test.js
```

Expected: page loads; staff sees assigned leads.

- [ ] **Step 6.4: Commit**

```bash
git add public/staff-painter-marketing.html public/js/pages/staff-painter-marketing.js tests/integration/staff-painter-marketing-ui.test.js
git commit -m "feat(painter-onboarding): staff painter marketing page upgrade"
```

---

## Task 7: Final Verification

- [ ] **Step 7.1: Run full unit test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7.2: Run linter**

```bash
npm run lint
```

Expected: no new errors.

- [ ] **Step 7.3: Manual smoke via curl**

Create a lead, assign, followup, invite, register with token, approve. Verify each step returns expected status.

- [ ] **Step 7.4: Commit any fixes**

```bash
git add -A
git commit -m "fix(painter-onboarding): address review/test findings"
```

---

## Self-Review Checklist

- [ ] Every spec requirement maps to a task.
- [ ] No placeholders (TBD/"later"/"etc") remain.
- [ ] File paths match the actual repo layout.
- [ ] Permission module/action names match the spec.
- [ ] Tests cover duplicate phone, invite token, Zoho link, staff approval.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-30-painter-onboarding-marketing-plan.md`.

**Choose execution approach:**

1. **Subagent-Driven (recommended)** — dispatch one Builder per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which would you like?
