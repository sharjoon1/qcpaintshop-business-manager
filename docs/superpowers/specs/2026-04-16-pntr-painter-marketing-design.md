# PNTR Painter Marketing System — Design Spec

**Date**: 2026-04-16
**Status**: Approved (brainstorming complete, awaiting implementation)
**Owner**: sharjoon1

## 1. Goal & Background

The Painter Loyalty Program (`painters` table, OTP login, points, referrals) was built but is under-utilized. Meanwhile, hundreds of painters are already saved in Zoho Books as customers with the **`PNTR`** name prefix (e.g., `PNTR RMD Karthik`), and they regularly buy paint either directly (invoice in painter's name) or by referring customers (invoice in customer name + painter as Zoho **Sales Person**).

This system bridges the two worlds:
1. **Bulk-import** all PNTR Zoho customers as a marketing pool
2. **Branch-wise daily marketing assignment** to staff (sticky owner + daily quota)
3. **Outcome tracking** with status-driven re-contact cycle
4. **Convert** interested painters into the formal Painter Program (with painter consent via OTP activation)
5. **Universal Zoho sync** — every new painter (regardless of source) auto-creates Zoho Customer + Sales Person
6. **Annual points backfill** from Dec 2025 invoices for both attribution paths (direct billing + salesperson)

## 2. Three Painter Creation Paths (Converge to One Hook)

```
Path A: Lead → Convert button (Staff during marketing)
Path B: Admin direct add (admin-painters page)
Path C: Self-register (app OTP) / Referral link

   ↓ all three paths ↓
   
PainterCreatedHook (services/painter-zoho-sync-service.js)
  → Auto-create Zoho Customer "PNTR {BranchCode} {Name}"
  → Auto-create Zoho Sales Person "{Name} {Phone}"
  → Store IDs back to painters.zoho_customer_id / .zoho_salesperson_id
  → Trigger annual points backfill if activated
```

**Phone is the universal identity key.** `painters.phone` and `painter_leads.phone` both UNIQUE. Cross-system matching always uses normalized phone (last 10 digits).

## 3. Data Model

### 3.1 New Tables

#### `painter_leads` — Marketing pool (one row per Zoho PNTR painter)
```sql
CREATE TABLE painter_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zoho_customer_id VARCHAR(50) NULL,
  painter_id INT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(255) NULL,
  branch_id INT NULL,
  branch_detected_via ENUM('zoho_branch_id','name_prefix','invoice_history','admin_assign') NULL,
  assigned_to INT NULL,
  status ENUM(
    'new','in_progress','interested','converted','active_painter',
    'not_interested','unreachable','wrong_number','duplicate','snoozed'
  ) DEFAULT 'new',
  last_contact_date TIMESTAMP NULL,
  last_outcome VARCHAR(50) NULL,
  next_eligible_date DATE NULL,
  total_attempts INT DEFAULT 0,
  contact_count INT DEFAULT 0,
  notes TEXT NULL,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  converted_at TIMESTAMP NULL,
  activated_at TIMESTAMP NULL,
  INDEX idx_branch_assigned (branch_id, assigned_to),
  INDEX idx_next_eligible (next_eligible_date, status),
  INDEX idx_painter (painter_id),
  INDEX idx_zoho (zoho_customer_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_lead_followups` — Every call/whatsapp/visit log
```sql
CREATE TABLE painter_lead_followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_lead_id INT NOT NULL,
  user_id INT NOT NULL,
  followup_type ENUM('call','whatsapp','visit') NOT NULL,
  call_status ENUM('connected','not_answered','wrong_number','switched_off','busy') NULL,
  outcome ENUM(
    'interested_in_program','already_aware','will_visit_shop',
    'wants_callback','not_interested','wrong_number','no_answer'
  ) NULL,
  next_followup_date DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lead (painter_lead_id),
  INDEX idx_user_date (user_id, created_at),
  FOREIGN KEY (painter_lead_id) REFERENCES painter_leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_daily_assignments` — Today's list snapshot per staff
```sql
CREATE TABLE painter_daily_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  branch_id INT NOT NULL,
  painter_lead_id INT NOT NULL,
  assigned_date DATE NOT NULL,
  contacted_at TIMESTAMP NULL,
  contact_outcome VARCHAR(50) NULL,
  UNIQUE KEY uniq_daily (user_id, painter_lead_id, assigned_date),
  INDEX idx_staff_date (user_id, assigned_date),
  INDEX idx_branch_date (branch_id, assigned_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_marketing_config` — Per-branch + per-staff overrides
```sql
CREATE TABLE painter_marketing_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('branch','user') NOT NULL,
  scope_id INT NOT NULL,
  daily_quota INT NOT NULL DEFAULT 10,
  recycle_days_new INT DEFAULT 7,
  recycle_days_callback INT DEFAULT 3,
  recycle_days_will_visit INT DEFAULT 14,
  recycle_days_already_aware INT DEFAULT 60,
  recycle_days_not_interested INT DEFAULT 30,
  recycle_days_unreachable INT DEFAULT 60,
  recycle_days_active_painter INT DEFAULT 45,
  is_active TINYINT DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_scope (scope, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_zoho_salesperson_map` — Zoho Sales Person ↔ Painter
```sql
CREATE TABLE painter_zoho_salesperson_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zoho_salesperson_id VARCHAR(50) NOT NULL UNIQUE,
  zoho_salesperson_name VARCHAR(255) NOT NULL,
  zoho_salesperson_phone VARCHAR(20) NULL,
  painter_id INT NULL,
  match_confidence ENUM('exact_phone','exact_name','fuzzy_name','unmatched') DEFAULT 'unmatched',
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_painter (painter_id),
  INDEX idx_phone (zoho_salesperson_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_pntr_import_runs` — Audit log
```sql
CREATE TABLE painter_pntr_import_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_type ENUM('initial_bulk','incremental_daily','manual') NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  total_zoho_pntr_customers INT DEFAULT 0,
  imported_count INT DEFAULT 0,
  linked_existing_painter INT DEFAULT 0,
  duplicates_queued INT DEFAULT 0,
  branch_unresolved_count INT DEFAULT 0,
  errors_count INT DEFAULT 0,
  triggered_by INT NULL,
  notes TEXT NULL,
  status ENUM('running','completed','failed') DEFAULT 'running',
  INDEX idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_lead_duplicate_queue` — Scenario 3 review
```sql
CREATE TABLE painter_lead_duplicate_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_painter_lead_id INT NULL,
  duplicate_zoho_customer_id VARCHAR(50) NOT NULL,
  duplicate_zoho_name VARCHAR(255) NOT NULL,
  duplicate_phone VARCHAR(20) NOT NULL,
  resolution ENUM('pending','merged','kept_original','kept_duplicate','ignored') DEFAULT 'pending',
  resolved_by INT NULL,
  resolved_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resolution (resolution)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### `painter_zoho_sync_queue` — Failed Zoho creates retry
```sql
CREATE TABLE painter_zoho_sync_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  sync_type ENUM('customer','salesperson','both') NOT NULL,
  status ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  attempts INT DEFAULT 0,
  last_error TEXT NULL,
  next_retry_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_status_retry (status, next_retry_at),
  INDEX idx_painter (painter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 ALTER existing tables

#### `painters` — Add Zoho linkage + lifecycle
```sql
ALTER TABLE painters
  ADD COLUMN zoho_customer_id VARCHAR(50) NULL AFTER profile_photo,
  ADD COLUMN zoho_salesperson_id VARCHAR(50) NULL AFTER zoho_customer_id,
  ADD COLUMN created_via ENUM('zoho_import','staff_convert','admin_add','self_register','referral')
    DEFAULT 'self_register' AFTER zoho_salesperson_id,
  ADD COLUMN activated_at TIMESTAMP NULL AFTER created_via,
  ADD COLUMN source_lead_id INT NULL AFTER activated_at,
  ADD INDEX idx_zoho_customer (zoho_customer_id),
  ADD INDEX idx_zoho_salesperson (zoho_salesperson_id),
  ADD INDEX idx_activated (activated_at);
```

**Activation semantics**:
- `status='approved' AND activated_at IS NULL` → **pending activation** (no points awards)
- `status='approved' AND activated_at IS NOT NULL` → **fully active** (points awards enabled)

#### `painter_invoices_processed` — Track both attribution paths
```sql
ALTER TABLE painter_invoices_processed
  ADD COLUMN attribution_type ENUM('direct_billing','salesperson','painter_estimate')
    DEFAULT 'painter_estimate' AFTER zoho_invoice_id,
  ADD COLUMN source_invoice_date DATE NULL AFTER attribution_type,
  DROP INDEX uniq_painter_invoice,  -- if exists; preserve existing data
  ADD UNIQUE KEY uniq_painter_invoice_type (painter_id, zoho_invoice_id, attribution_type);
```

Existing painter_estimate dedup keys (`EST-{id}`) keep working. New keys: `ZINV-{zoho_invoice_id}` with attribution_type discriminator.

#### `zoho_invoices` — **PREREQUISITE** add salesperson_id
```sql
ALTER TABLE zoho_invoices
  ADD COLUMN zoho_salesperson_id VARCHAR(50) NULL AFTER zoho_location_id,
  ADD COLUMN zoho_salesperson_name VARCHAR(255) NULL AFTER zoho_salesperson_id,
  ADD INDEX idx_salesperson (zoho_salesperson_id);
```

Verified absent — must be added BEFORE backfill can run. `services/zoho-api.js::syncInvoices()` to fetch+store these fields. One-time re-sync of Dec 2025+ invoices required (covered in implementation plan).

## 4. Phase 1: Bulk Import Pipeline

### 4.1 One-time Initial Import (Admin-triggered)

**Trigger**: Admin clicks "Run Initial PNTR Import" on `admin-painters.html` → "Marketing" tab → "Import Runs" sub-tab.

**Pipeline** (single transaction per painter, batched 100):

```
1. Fetch all Zoho customers WHERE contact_name LIKE '%PNTR%' (paginated 200/page)
2. For each Zoho customer:
   a. Sanitize phone → normalized last 10 digits
      → If empty/invalid: skip, increment errors_count
   b. Detect branch (priority chain — first hit wins):
      [1] Parse name prefix: regex /PNTR\s+([A-Z]{2,4})\s+/i
          → match group → branches.code lookup → branch_id
      [2] zoho_customers_map.branch_id (if customer already mapped)
      [3] Most-frequent invoice branch from last 180 days
          (zoho_invoices WHERE customer_id=X GROUP BY local_branch_id ORDER BY COUNT DESC LIMIT 1)
      [4] NULL → mark for Admin Review queue
   c. Check phone against painters.phone (normalized):
      → MATCH (Scenario 1): set painters.zoho_customer_id, INSERT painter_leads
        with status='active_painter', painter_id=X. NO daily list inclusion.
      → No match: continue
   d. Check phone against painter_leads.phone:
      → MATCH (Scenario 3 duplicate): INSERT painter_lead_duplicate_queue
      → No match: INSERT painter_leads (status='new', branch_id from step b)
   e. Increment counters in painter_pntr_import_runs row
3. Salesperson sync (after customer pass):
   For each Zoho Sales Person:
     a. Parse name for phone suffix (regex /(\d{10})$/)
     b. Match by phone → painter (exact_phone, highest confidence)
     c. Else match by name → painter (exact_name)
     d. Else fuzzy match (Levenshtein < 3 on lowercase) → fuzzy_name
     e. Else unmatched → admin review
     f. INSERT painter_zoho_salesperson_map
4. Mark run completed, return summary
```

**Phone normalizer**: strip all non-digits, drop leading "91" if 12 digits, take last 10 digits. Reject if final length ≠ 10.

**Branch prefix mapping** (initial — verify against actual `branches.code` data):
- RMD, TCM, PKD, RMM, PBN — and any others in `branches.code` table

### 4.2 Incremental Daily Sync (Cron 02:30 IST)

`services/painter-marketing-scheduler.js::runIncrementalImport()`:
- Fetch Zoho PNTR customers `WHERE last_modified_time > {last_run.completed_at}`
- Same pipeline as 4.1 steps 2a-2e
- Same salesperson sync (step 3)
- Logs to `painter_pntr_import_runs` with `run_type='incremental_daily'`

### 4.3 Admin Review Queues

`admin-painters.html` → "Marketing" tab → 7 sub-tabs (4 are review surfaces):

| Sub-tab | Shows | Bulk action |
|---------|-------|-------------|
| Branch Unassigned | painter_leads WHERE branch_id IS NULL | Multi-select → assign branch dropdown |
| Duplicate Phone Queue | grouped by phone, side-by-side | Per-group: Merge / Keep First / Keep Specific / Ignore |
| Salesperson Unmatched | painter_zoho_salesperson_map WHERE match_confidence='unmatched' | Search painter → link |
| Import Runs History | painter_pntr_import_runs DESC | View summary + "Re-run incremental" |

## 5. Phase 2: Daily Marketing Loop

### 5.1 Sticky Owner Assignment

- **Initial import**: round-robin balance painters across active staff in branch
- **Incremental import**: new painter → assigned to staff with fewest current painters in branch (load-balanced)
- **Staff inactive**: admin button "Reassign Staff X's Painters" → redistributes to remaining branch staff
- **Manual reassign**: admin can move individual painter via lead detail page

### 5.2 Daily List Generation Cron (06:00 IST)

`services/painter-marketing-scheduler.js::generateDailyLists()`:

```
For each active branch:
  branchConfig = SELECT * FROM painter_marketing_config WHERE scope='branch' AND scope_id=branchId
  For each active staff in branch:
    quota = (per-staff override) OR (branchConfig.daily_quota)
    
    eligible = SELECT * FROM painter_leads
      WHERE branch_id = X
        AND assigned_to = staffId
        AND status IN ('new','in_progress','interested','unreachable')
        AND (next_eligible_date IS NULL OR next_eligible_date <= TODAY)
        AND id NOT IN (SELECT painter_lead_id FROM painter_daily_assignments
                       WHERE assigned_date = TODAY)
      ORDER BY
        FIELD(status,'interested','in_progress','new','unreachable'),
        COALESCE(last_contact_date, '1970-01-01') ASC
      LIMIT quota
    
    INSERT INTO painter_daily_assignments
      (user_id, branch_id, painter_lead_id, assigned_date)
```

**Rollover policy**: Untouched assignments from yesterday (contacted_at IS NULL) are **prepended** to today's list — quota stays the same, total list = carry-over + new picks up to quota.

### 5.3 Staff Page (`staff-painter-marketing.html`)

```
Header: "🎨 Today's Painter Calls — 6 of 12 contacted"
        Progress bar [██████░░░░░░] 50%
        Filter pills: [All 12] [Pending 6] [Done 6]

Painter Card:
┌───────────────────────────────────────┐
│ 📷 Karthik [PNTR RMD]      🔵 Interested│
│ 📞 9876543210                          │
│ Last: 12 days ago — Wants Callback    │
│ "Wanted to know about discount tier" │
│ [📞 Call] [💬 WhatsApp] [✏️ Log Outcome]│
└───────────────────────────────────────┘
```

- 📞 Call → `tel:9876543210`
- 💬 WhatsApp → `wa.me/91{phone}?text={encoded_template}` (uses staff's WA, not API)
- ✏️ Log Outcome → modal

### 5.4 Outcome Logging Modal

```
Channel:   ◉ Call   ○ WhatsApp   ○ Visited Shop
Status:    [if Call] Connected / Not Answered / Wrong Number / Switched Off / Busy
Outcome:   [if Connected]
           Interested in Program ⭐
           Already Aware
           Will Visit Shop
           Wants Callback (date picker)
           Not Interested
Notes:     [textarea, optional]
[Cancel]   [Save & Next]
```

**On save**:
1. INSERT painter_lead_followups
2. UPDATE painter_leads (last_contact_date, last_outcome, status, next_eligible_date, total_attempts++, contact_count++ if connected)
3. UPDATE painter_daily_assignments (contacted_at, contact_outcome)
4. If outcome='wants_callback' with date → next_eligible_date = that date

### 5.5 Outcome → Status & Recycle Map

| Outcome | New Status | next_eligible (default; configurable per branch) |
|---------|-----------|--------------------------------------------------|
| interested_in_program | `interested` | TODAY + 7d |
| wants_callback | `in_progress` | callback date OR TODAY+3d |
| will_visit_shop | `in_progress` | TODAY + 14d |
| already_aware | `in_progress` | TODAY + 60d |
| not_interested | `not_interested` | TODAY + 30d |
| not_answered (5+ consecutive, no connect between) | `unreachable` | TODAY + 60d |
| not_answered (< 5) | unchanged | TODAY + 3d |
| wrong_number | `wrong_number` | NULL (off list permanently) |
| switched_off / busy | unchanged | TODAY + 1d |

### 5.6 WhatsApp Marketing Template

Per-branch customizable in `ai_config` key `painter_marketing_wa_template`:

```
{painter_name} அவர்களே,
இது Quality Colours {branch_name}.
நாங்க புதுசா painter loyalty program start பண்றோம் — 
billing total-க்கு points கிடைக்கும், withdrawal-உம் பண்ணலாம்.
விரிவா பேசணும்-னா: {staff_phone}
```

(Note: per project rule, Tamil greetings never use வணக்கம் — see `feedback_tamil_message_greetings.md`.)

### 5.7 Notifications

| Time (IST) | Recipient | Channel | Message |
|-----------|-----------|---------|---------|
| 06:30 | Each staff | FCM push | "🎨 Today's painter calls ready — N painters" + deep link |
| 17:00 | Staff with < 50% completion | FCM | "⚠️ M painter calls remaining today" |
| 18:00 | Branch manager | WhatsApp | If any staff < 30% completion: summary alert |
| Mon 09:00 | Admin/manager | WhatsApp | Weekly branch performance report |

## 6. Phase 3: Lead → Painter Conversion (Path A — Hybrid D)

### 6.1 Conversion Flow

1. Staff sees painter_lead with outcome='interested_in_program' → "Convert to Painter Program" button enabled
2. Click → quick form modal (referral source, brand preference confirm) → submit
3. Backend:
   - INSERT painters (status='approved', activated_at=NULL, created_via='staff_convert', source_lead_id=X)
   - UPDATE painter_leads SET painter_id=X, status='converted', converted_at=NOW()
   - Fire `PainterCreatedHook(painterId)` (Section 7)
   - Send WhatsApp activation invite (Section 6.3)
4. Painter app/website: OTP login → `UPDATE painters SET activated_at=NOW()`, `painter_lead.status='active_painter'`, fire backfill

### 6.2 Admin Force-Convert Override

Admin can force-convert any painter_lead (regardless of outcome) from admin UI:
- "Force Convert to Painter" button on painter_lead detail
- Skips outcome check, runs same Path A flow
- Useful when staff forgot to log outcome but verbally confirmed interest

### 6.3 WhatsApp Activation Invite

```
வரவேற்கிறோம் {painter_name}!
Quality Colours Painter Program-ல உங்களை சேர்த்துக்கொள்கிறோம் 🎨

App download → OTP login = activation:
🔗 https://act.qcpaintshop.com/painter-onboard?ref={painter_id}

OTP login பண்ணினா உங்க Dec 2025-ல இருந்து இதுவரை வாங்கின billing-க்கு annual points 
automatic-ஆ credit ஆகும்.
```

Sent via existing General WhatsApp session (branch_id=0).

## 7. Universal Painter → Zoho Sync Hook

`services/painter-zoho-sync-service.js::syncPainterToZoho(painterId)`:

```
async function syncPainterToZoho(painterId) {
  painter = SELECT * FROM painters WHERE id = painterId
  
  // Idempotency
  if (painter.zoho_customer_id AND painter.zoho_salesperson_id) return { skipped: true }
  
  branch = SELECT code, name, zoho_location_id FROM branches WHERE id = painter.branch_id
  
  // STEP 1: Customer (skip if already linked)
  if (!painter.zoho_customer_id):
    existing = SELECT * FROM zoho_customers_map
      WHERE normalize(zoho_phone) = normalize(painter.phone)
        AND zoho_contact_name LIKE '%PNTR%'
    
    if (existing):
      // Scenario 4: link existing
      UPDATE painters SET zoho_customer_id = existing.zoho_contact_id
      UPDATE painter_leads SET painter_id=painterId, status='converted'
        WHERE phone = painter.phone
    else:
      zohoName = `PNTR ${branch.code} ${painter.full_name}`
      try {
        zohoCustomer = await zohoApi.createCustomer({
          contact_name: zohoName,
          mobile: painter.phone,
          email: painter.email,
          branch_id: branch.zoho_location_id,
          cf_painter_id: painter.id
        })
        UPDATE painters SET zoho_customer_id = zohoCustomer.contact_id
        INSERT zoho_customers_map (zoho_contact_id, zoho_contact_name, zoho_phone,
                                   branch_id, last_synced_at)
      } catch (err) {
        INSERT painter_zoho_sync_queue (painter_id, sync_type='customer',
                                        status='pending', last_error=err.message,
                                        next_retry_at = NOW() + INTERVAL 1 HOUR)
        return { queued: 'customer' }
      }
  
  // STEP 2: Salesperson
  if (!painter.zoho_salesperson_id):
    existingSP = SELECT * FROM painter_zoho_salesperson_map
      WHERE zoho_salesperson_phone = painter.phone
         OR zoho_salesperson_name = `${painter.full_name} ${painter.phone}`
    
    if (existingSP):
      UPDATE painter_zoho_salesperson_map SET painter_id = painterId, match_confidence='exact_phone'
      UPDATE painters SET zoho_salesperson_id = existingSP.zoho_salesperson_id
    else:
      spName = `${painter.full_name} ${painter.phone}`  // user's naming convention
      try {
        zohoSP = await zohoApi.createSalesperson({
          salesperson_name: spName,
          email: painter.email
        })
        UPDATE painters SET zoho_salesperson_id = zohoSP.salesperson_id
        INSERT painter_zoho_salesperson_map (zoho_salesperson_id, zoho_salesperson_name,
                                            zoho_salesperson_phone, painter_id,
                                            match_confidence='exact_phone')
      } catch (err) {
        INSERT painter_zoho_sync_queue (painter_id, sync_type='salesperson', ...)
      }
  
  // STEP 3: Notify (only if both succeeded and painter is activated)
  if (painter.activated_at AND painter.zoho_customer_id AND painter.zoho_salesperson_id):
    notification.send(painter.user_id, { type: 'zoho_synced', ... })
}
```

### 7.1 Retry Cron (03:00 IST)

`painter-zoho-sync-service.retryQueue()`:
- SELECT * FROM painter_zoho_sync_queue WHERE status='pending' AND next_retry_at <= NOW() LIMIT 50
- For each: re-run syncPainterToZoho — on success mark completed, on failure increment attempts + push next_retry_at exponentially (1h, 4h, 12h, 1d, then admin alert at attempts=5)

### 7.2 Phone Duplicate Enforcement (5 Scenarios)

| Scenario | Detection | Action |
|----------|-----------|--------|
| 1 | Zoho PNTR phone matches existing painter (at import) | Auto-link, status='active_painter', no daily list |
| 2 | Zoho PNTR phone matches non-painter customer (at import) | Import as painter (PNTR priority), set linkage flag |
| 3 | Two PNTR Zoho customers same phone (at import) | First wins; second → duplicate_queue |
| 4 | Painter app OTP register matches existing PNTR Zoho customer | Auto-link via PainterCreatedHook step 1; backfill triggered |
| 5 | Painter re-registration attempt (phone exists in painters) | Block: "Already registered, please login" |

DB-level safety: `painter_leads.phone` UNIQUE, `painters.phone` UNIQUE.

## 8. Annual Points Backfill

### 8.1 Service (`services/painter-points-backfill-service.js`)

**Trigger options**:
1. **On painter activation** (activated_at set): auto-process that painter
2. **Admin bulk button** "Backfill from Date" → date picker (default 2025-12-01) → preview → confirm
3. **Daily incremental cron** at 03:30 IST: new invoices since yesterday → process for already-activated painters

**Algorithm** (per painter):
```
async function backfillPainter(painterId, fromDate) {
  painter = SELECT * FROM painters WHERE id=painterId AND activated_at IS NOT NULL
  if (!painter) return { skipped: 'not_activated' }
  
  // SCENARIO 1: Direct billing (invoice in painter's name)
  directInvoices = SELECT zi.* FROM zoho_invoices zi
    JOIN zoho_customers_map zcm ON zcm.local_customer_id = zi.customer_id
    WHERE zcm.zoho_contact_id = painter.zoho_customer_id
      AND zi.invoice_date >= fromDate
      AND zi.status NOT IN ('void','draft')
      AND zi.zoho_invoice_id NOT IN (
        SELECT zoho_invoice_id FROM painter_invoices_processed
        WHERE painter_id = painterId AND attribution_type='direct_billing'
      )
  
  for each invoice in directInvoices:
    // Self-billing rule: annual pool only (per existing painter-points-engine.js)
    annualPoints = invoice.total × selfBillingAnnualRate
    INSERT painter_points_transactions (painter_id, pool='annual', points=annualPoints,
                                       reference=`ZINV-${invoice.zoho_invoice_id}-direct`,
                                       source_date=invoice.invoice_date)
    INSERT painter_invoices_processed (painter_id, zoho_invoice_id,
                                       attribution_type='direct_billing',
                                       source_invoice_date=invoice.invoice_date,
                                       points_awarded=annualPoints)
  
  // SCENARIO 2: Salesperson-attributed (invoice in customer name, painter as SP)
  if (painter.zoho_salesperson_id):
    spInvoices = SELECT * FROM zoho_invoices
      WHERE zoho_salesperson_id = painter.zoho_salesperson_id
        AND invoice_date >= fromDate
        AND status NOT IN ('void','draft')
        AND zoho_invoice_id NOT IN (
          SELECT zoho_invoice_id FROM painter_invoices_processed
          WHERE painter_id = painterId AND attribution_type='salesperson'
        )
    
    for each invoice in spInvoices:
      // Customer-billing rule: regular + annual (per existing engine)
      regularPts = invoice.total × customerBillingRegularRate
      annualPts = invoice.total × customerBillingAnnualRate
      INSERT painter_points_transactions (pool='regular', points=regularPts,
                                         reference=`ZINV-${id}-salesperson-r`)
      INSERT painter_points_transactions (pool='annual', points=annualPts,
                                         reference=`ZINV-${id}-salesperson-a`)
      INSERT painter_invoices_processed (attribution_type='salesperson',
                                         points_awarded=regularPts+annualPts, ...)
  
  // Notify (one summary)
  totalNew = sum of all points awarded in this run
  if (totalNew > 0):
    notification.send(painter.user_id, {
      type: 'points_backfilled',
      title: '🎉 Backfill complete',
      body: `Dec 2025-ல இருந்து உங்களுக்கு ${totalNew} points credit ஆச்சு!`
    })
}
```

**Idempotency**:
- `painter_invoices_processed` UNIQUE(painter_id, zoho_invoice_id, attribution_type)
- Re-run safe; already-processed invoices skipped
- Same invoice CAN award points TWICE if painter is BOTH customer AND salesperson on it (intentional, per existing dual-attribution rule)

**Rate config** (in `ai_config`):
- `painter_self_billing_annual_rate` (e.g., 0.005 = 0.5%)
- `painter_customer_billing_regular_rate` (e.g., 0.005)
- `painter_customer_billing_annual_rate` (e.g., 0.005)
- All read from existing `painter-points-engine.js` to maintain consistency

### 8.2 Admin Backfill UI

`admin-painters.html` → Marketing → "Points Backfill" sub-tab:

```
┌──────────────────────────────────────────────────┐
│ Annual Points Backfill                            │
├──────────────────────────────────────────────────┤
│ Backfill from date: [2025-12-01 ▾]                │
│ Scope: ◉ All activated painters  ○ Specific      │
│                                                    │
│ [Preview] → 47 painters, ~2,340 invoices,        │
│             estimated 8,234,500 points            │
│                                                    │
│ [Run Backfill]   ← disabled until preview shown  │
│                                                    │
│ ── Recent Runs ──                                 │
│ 2026-04-16 14:23  47 painters  8.2M pts  ✅      │
└──────────────────────────────────────────────────┘
```

## 9. Cron Schedule (All New Jobs)

| Time (IST) | Job | Purpose |
|-----------|-----|---------|
| 02:30 | `painter-marketing-scheduler.runIncrementalImport()` | Sync new PNTR Zoho customers + sales persons |
| 03:00 | `painter-zoho-sync-service.retryQueue()` | Retry failed Zoho syncs |
| 03:30 | `painter-points-backfill-service.runDailyIncremental()` | New invoices → points for activated painters |
| 06:00 | `painter-marketing-scheduler.generateDailyLists()` | Build today's painter call lists per staff |
| 06:30 | `notification.sendDailyListReady()` | FCM push to staff |
| 17:00 | `notification.sendIncompleteReminder()` | Push reminder if < 50% complete |
| 18:00 | `notification.sendAdminLowPerformanceAlert()` | WA to manager if any staff < 30% |
| Mon 09:00 | `notification.sendWeeklyPerformanceReport()` | Weekly branch summary |

## 10. UI Surfaces

### 10.1 Admin (`admin-painters.html` — new "Marketing" tab with 7 sub-tabs)
1. Branch Unassigned (review queue)
2. Duplicate Phone (review queue)
3. Salesperson Unmatched (review queue)
4. Import Runs History
5. Performance (today/week/month metrics, heatmap)
6. Points Backfill
7. Marketing Config (per-branch quotas, recycle days, WhatsApp template)

### 10.2 Staff (`staff-painter-marketing.html` — new page)
- Today's list (cards + outcome modal)
- "My Painters" tab — full sticky-owner list with filters (status, branch, last contact)
- "History" tab — all my followups, conversion rate stat

### 10.3 Painter (existing `painter-onboard.html`)
- Already exists; just add `?ref={painter_id}` param handling for OTP-then-activate flow

## 11. Permissions

New permission keys (added to `roles` config):
- `painters.marketing.view` — see daily list (staff)
- `painters.marketing.contact` — log followups (staff)
- `painters.marketing.manage` — config, review queues, backfill (admin/manager)
- `painters.marketing.convert` — convert lead to painter

## 12. Module Layout

```
services/
  pntr-import-service.js              # Bulk + incremental Zoho PNTR scan
  painter-zoho-sync-service.js        # Universal painter→Zoho hook + retry
  painter-marketing-scheduler.js       # Daily list generation + cron entry
  painter-points-backfill-service.js   # Dec 2025+ invoice scan + points

routes/
  painter-marketing.js                 # All marketing API endpoints

migrations/
  migrate-pntr-painter-marketing.js    # All 8 new tables + 3 ALTERs
  migrate-zoho-invoices-salesperson.js # PREREQUISITE: zoho_invoices.zoho_salesperson_id

public/
  admin-painters.html                  # ALTER: add Marketing tab + 7 sub-tabs
  staff-painter-marketing.html         # NEW page
  painter-onboard.html                 # ALTER: ?ref param handling

tests/
  pntr-import-service.test.js
  painter-zoho-sync-service.test.js
  painter-marketing-scheduler.test.js
  painter-points-backfill-service.test.js
  painter-marketing-routes.test.js
```

## 13. Testing Strategy

| Layer | Coverage |
|-------|----------|
| **Unit** (~33 tests) | branch prefix parser, phone normalizer, salesperson matcher (exact/fuzzy), outcome→status mapper, recycle date calculator, backfill points calculator (5 fixtures × 2 scenarios), PainterCreatedHook idempotency |
| **Integration** (~12 tests) | full bulk import (50 fixture customers), daily list cron (3 branches × 5 staff), Path A/B/C end-to-end, Zoho sync hook idempotency, backfill idempotency, retry queue exponential backoff |
| **E2E** (~6 tests) | staff logs outcome → next day verify list excludes; painter activates → backfill runs → points appear; admin force-convert flow; salesperson-only painter gets points; duplicate phone scenarios 1-5 |
| **Failure** | Zoho API down → queue → retry; phone missing → skip + log; branch unresolved → review queue; rate limit (existing circuit breaker reused) |
| **Performance** | initial import of 1000+ painters in single run < 5 min |

## 14. Prerequisites & Risks

### Prerequisites (must be done before main implementation)
1. **Verify branch codes**: confirm `branches.code` column has the expected short codes (RMD/TCM/PKD/RMM/PBN, plus any others)
2. **Add `zoho_invoices.zoho_salesperson_id` column** + update `services/zoho-api.js::syncInvoices()` to fetch+store it
3. **One-time backfill** of `zoho_invoices.zoho_salesperson_id` for Dec 2025+ invoices via re-sync
4. **Verify Zoho API supports salesperson creation** via `zohoApi.createSalesperson()` — may need to extend `services/zoho-api.js` if not present
5. **Verify `cf_painter_id` custom field exists** on Zoho contacts (else create via Zoho UI before sync runs)

### Risks
- **Zoho rate limits** during initial bulk import: existing circuit breaker (`production-monitor.js`) handles this, but initial import may take longer if hitting limits
- **Phone data quality**: hundreds of PNTR customers may have empty/malformed phones — they'll skip with error logs; admin must clean these in Zoho manually
- **Salesperson name fuzzy matching**: Levenshtein < 3 may produce false positives; admin review queue must be diligent
- **Painter app activation friction**: if many painters never OTP-login, they remain in pending_activation forever — no points awarded. Mitigation: WhatsApp reminders, staff follow-up prompt
- **Existing painter_invoices_processed schema**: needs verification that ALTER won't break existing painter estimate dedup (`EST-{id}` keys)

## 15. Out of Scope (Explicitly Deferred)

- Branch transfer of painters (if painter moves shops)
- Multi-language UI for staff page (Tamil-only for now in templates)
- Automated SMS fallback if WhatsApp send fails
- Painter-to-painter referral chain reward (existing referral system handles this)
- Historical conversion analytics dashboard (Phase 2 enhancement)
- Lead Manager `leads` table integration (intentionally separate `painter_leads` table)

---

**End of spec.**
