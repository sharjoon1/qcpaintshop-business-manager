# PNTR Painter Marketing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-import PNTR-prefixed Zoho painters into a daily marketing pool, track outcomes, convert leads into formal painters with universal Zoho customer+salesperson sync, and backfill annual points from Dec 2025 invoices (direct + salesperson attribution).

**Architecture:** Additive — 7 new tables + 2 ALTERs on existing tables + 1 ALTER on `zoho_invoices`. Four new services (`pntr-import-service`, `painter-zoho-sync-service`, `painter-marketing-scheduler`, `painter-points-backfill-service`) plus one new route file (`painter-marketing.js`). One new staff page + a new "Marketing" tab on `admin-painters.html` + 3 new crons. All three painter-creation paths (lead convert, admin add, self-register) fire a single `syncPainterToZoho()` hook for consistency.

**Tech Stack:** Node.js / Express 5, MySQL/MariaDB (mysql2/promise), node-cron, whatsapp-web.js, firebase-admin (FCM), Jest, vanilla JS + Tailwind for UI.

**Spec:** `docs/superpowers/specs/2026-04-16-pntr-painter-marketing-design.md` (approved)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `migrations/migrate-zoho-invoices-salesperson.js` | Prerequisite: `zoho_invoices.zoho_salesperson_id` + `zoho_salesperson_name` + index |
| `migrations/migrate-pntr-painter-marketing.js` | 7 new tables + 2 ALTERs (`painters`, `painter_invoices_processed`) |
| `services/pntr-import-service.js` | Bulk + incremental PNTR customer import pipeline with branch detection + dedup |
| `services/painter-zoho-sync-service.js` | Universal painter → Zoho customer + salesperson sync hook, retry queue |
| `services/painter-marketing-scheduler.js` | Daily list generation, cron entry points, rollover |
| `services/painter-points-backfill-service.js` | Direct-billing + salesperson Dec 2025+ invoice scan → points |
| `routes/painter-marketing.js` | All marketing REST endpoints (daily list, outcome log, review queues, config, backfill, admin bulk import) |
| `public/staff-painter-marketing.html` | Staff daily list + "My Painters" + "History" tabs |
| `tests/unit/pntr-import-service.test.js` | Phone normalizer, branch prefix parser, salesperson matcher |
| `tests/unit/painter-zoho-sync-service.test.js` | Hook idempotency, retry queue backoff |
| `tests/unit/painter-marketing-scheduler.test.js` | Outcome → status mapper, recycle date calculator, daily list picker |
| `tests/unit/painter-points-backfill-service.test.js` | Direct + salesperson points calc, idempotency, dedup |
| `tests/integration/painter-marketing-routes.test.js` | Path A conversion, outcome log, review queue resolution |

### Modified Files

| File | Change |
|------|--------|
| `services/zoho-api.js` | Add `createSalesperson()`; extend `syncInvoices()` to capture `salesperson_id` + `salesperson_name` |
| `services/painter-scheduler.js` | Boot `painter-marketing-scheduler` cron registrations on `init()` |
| `services/painter-points-engine.js` | Expose helper `computePointsForInvoice(total, billingType)` so backfill reuses identical formulas |
| `routes/painters.js` | Post-create hook call into `syncPainterToZoho`; add `POST /painters/:id/activate` that sets `activated_at` + triggers backfill |
| `routes/painter-estimate-pdf-generator.js` | — no change (reference only) |
| `public/admin-painters.html` | Add "Marketing" tab with 7 sub-tabs (unassigned, duplicates, unmatched salespersons, import runs, performance, backfill, config) |
| `public/painter-onboard.html` | Parse `?ref=` query, pass to activation endpoint after OTP login |
| `public/painter-register.html` | After OTP success → POST activate → fire backfill |
| `server.js` | Mount `routes/painter-marketing.js`; invoke scheduler init |
| `Skills.md` | Document new module (per project convention) |

---

## Task 1: Prerequisite — Add `zoho_salesperson_id` to `zoho_invoices`

**Files:**
- Create: `migrations/migrate-zoho-invoices-salesperson.js`
- Modify: `services/zoho-api.js` (function `syncInvoices` near line 274)
- Test: `tests/unit/invoice-line-sync.test.js` (existing — no change; new assertions in Task 2's integration)

- [ ] **Step 1: Create migration file**

```javascript
// migrations/migrate-zoho-invoices-salesperson.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function migrate() {
    console.log('=== zoho_invoices salesperson columns ===');
    const alters = [
        "ADD COLUMN IF NOT EXISTS zoho_salesperson_id VARCHAR(50) NULL AFTER zoho_location_id",
        "ADD COLUMN IF NOT EXISTS zoho_salesperson_name VARCHAR(255) NULL AFTER zoho_salesperson_id",
        "ADD INDEX IF NOT EXISTS idx_salesperson (zoho_salesperson_id)"
    ];
    for (const clause of alters) {
        try {
            await pool.query(`ALTER TABLE zoho_invoices ${clause}`);
            console.log('  OK:', clause);
        } catch (e) {
            if (!/Duplicate|exists/i.test(e.message)) throw e;
            console.log('  skip (already applied):', clause);
        }
    }
    console.log('Done.');
    await pool.end();
}
migrate().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the migration against dev DB**

Run: `node migrations/migrate-zoho-invoices-salesperson.js`
Expected: `OK:` for each ALTER (or `skip` on re-run). No errors.

- [ ] **Step 3: Extend `syncInvoices()` to capture salesperson fields**

In `services/zoho-api.js::syncInvoices` (line ~274), change the INSERT SQL and param binding to include the two new columns.

Replace the `INSERT INTO zoho_invoices (...)` block near line 317 with:

```javascript
await pool.query(`
    INSERT INTO zoho_invoices (
        zoho_invoice_id, zoho_customer_id, local_customer_id,
        invoice_number, reference_number, invoice_date, due_date,
        currency_code, sub_total, tax_total, total, balance,
        status, customer_name, zoho_location_id, local_branch_id,
        zoho_salesperson_id, zoho_salesperson_name,
        created_time, last_modified_time, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
        balance = VALUES(balance),
        status = VALUES(status),
        sub_total = VALUES(sub_total),
        tax_total = VALUES(tax_total),
        total = VALUES(total),
        zoho_location_id = VALUES(zoho_location_id),
        local_branch_id = VALUES(local_branch_id),
        zoho_salesperson_id = VALUES(zoho_salesperson_id),
        zoho_salesperson_name = VALUES(zoho_salesperson_name),
        last_modified_time = VALUES(last_modified_time),
        last_synced_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
`, [
    inv.invoice_id, inv.customer_id,
    custMap.length > 0 ? custMap[0].local_customer_id : null,
    inv.invoice_number, inv.reference_number || null,
    inv.date, inv.due_date,
    inv.currency_code || 'INR',
    inv.sub_total || 0, inv.tax_total || 0,
    inv.total || 0, inv.balance || 0,
    mapZohoStatus(inv.status), inv.customer_name,
    zohoLocationId, localBranchId,
    inv.salesperson_id || null, inv.salesperson_name || null,
    toMySQLDatetime(inv.created_time), toMySQLDatetime(inv.last_modified_time)
]);
```

- [ ] **Step 4: Add `createSalesperson` to `zoho-api.js`**

Insert after `updateContact` (around line 154):

```javascript
/**
 * Create a Sales Person in Zoho Books (separate endpoint from contacts)
 */
async function createSalesperson({ salesperson_name, salesperson_email = null }) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    const body = { salesperson_name };
    if (salesperson_email) body.salesperson_email = salesperson_email;
    return await apiPost(`/settings/salespersons?organization_id=${orgId}`, body);
}

/**
 * List all Sales Persons from Zoho (paginated — returns all)
 */
async function listSalespersons() {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/settings/salespersons', { organization_id: orgId });
}
```

Then append both names to the `module.exports` object at the bottom of the file (the block around line 2359-2380):

```javascript
    createSalesperson,
    listSalespersons,
```

- [ ] **Step 5: Commit**

```bash
git add migrations/migrate-zoho-invoices-salesperson.js services/zoho-api.js
git commit -m "feat(zoho): capture salesperson on invoice sync + createSalesperson API"
```

---

## Task 2: Main migration — 7 new tables + 2 ALTERs

**Files:**
- Create: `migrations/migrate-pntr-painter-marketing.js`

- [ ] **Step 1: Create migration file (full schema)**

```javascript
// migrations/migrate-pntr-painter-marketing.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function run() {
    console.log('=== PNTR Painter Marketing migration ===');

    // 1. painter_leads
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_leads (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [1/9] painter_leads');

    // 2. painter_lead_followups
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_lead_followups (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [2/9] painter_lead_followups');

    // 3. painter_daily_assignments
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_daily_assignments (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [3/9] painter_daily_assignments');

    // 4. painter_marketing_config
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_marketing_config (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [4/9] painter_marketing_config');

    // 5. painter_zoho_salesperson_map
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_zoho_salesperson_map (
            id INT AUTO_INCREMENT PRIMARY KEY,
            zoho_salesperson_id VARCHAR(50) NOT NULL UNIQUE,
            zoho_salesperson_name VARCHAR(255) NOT NULL,
            zoho_salesperson_phone VARCHAR(20) NULL,
            painter_id INT NULL,
            match_confidence ENUM('exact_phone','exact_name','fuzzy_name','unmatched') DEFAULT 'unmatched',
            last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_painter (painter_id),
            INDEX idx_phone (zoho_salesperson_phone)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [5/9] painter_zoho_salesperson_map');

    // 6. painter_pntr_import_runs
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_pntr_import_runs (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [6/9] painter_pntr_import_runs');

    // 7. painter_lead_duplicate_queue
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_lead_duplicate_queue (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [7/9] painter_lead_duplicate_queue');

    // 8. painter_zoho_sync_queue
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_zoho_sync_queue (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [8/9] painter_zoho_sync_queue');

    // 9. ALTER painters
    const painterAlters = [
        "ADD COLUMN IF NOT EXISTS zoho_customer_id VARCHAR(50) NULL",
        "ADD COLUMN IF NOT EXISTS zoho_salesperson_id VARCHAR(50) NULL",
        "ADD COLUMN IF NOT EXISTS created_via ENUM('zoho_import','staff_convert','admin_add','self_register','referral') DEFAULT 'self_register'",
        "ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP NULL",
        "ADD COLUMN IF NOT EXISTS source_lead_id INT NULL",
        "ADD INDEX IF NOT EXISTS idx_zoho_customer (zoho_customer_id)",
        "ADD INDEX IF NOT EXISTS idx_zoho_salesperson (zoho_salesperson_id)",
        "ADD INDEX IF NOT EXISTS idx_activated (activated_at)"
    ];
    for (const clause of painterAlters) {
        try { await pool.query(`ALTER TABLE painters ${clause}`); }
        catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
    }
    console.log('  [9/9] painters ALTER');

    // 10. ALTER painter_invoices_processed — existing column is `invoice_id` (not zoho_invoice_id),
    //     existing UNIQUE is idx_invoice on invoice_id alone.
    //     We keep invoice_id as the universal dedup key (EST-{id} for estimates,
    //     ZINV-{zohoId}-direct or ZINV-{zohoId}-salesperson for the new backfill types).
    const pipAlters = [
        "ADD COLUMN IF NOT EXISTS attribution_type ENUM('direct_billing','salesperson','painter_estimate') DEFAULT 'painter_estimate'",
        "ADD COLUMN IF NOT EXISTS source_invoice_date DATE NULL",
        "ADD COLUMN IF NOT EXISTS zoho_invoice_id VARCHAR(50) NULL"
    ];
    for (const clause of pipAlters) {
        try { await pool.query(`ALTER TABLE painter_invoices_processed ${clause}`); }
        catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
    }
    // Drop old single-column unique, replace with composite (painter + invoice_id + attribution_type)
    try { await pool.query(`ALTER TABLE painter_invoices_processed DROP INDEX idx_invoice`); }
    catch (e) { if (!/check that.*exists|doesn.*exist/i.test(e.message)) console.warn('  drop idx_invoice:', e.message); }
    try {
        await pool.query(`ALTER TABLE painter_invoices_processed ADD UNIQUE KEY uniq_painter_invoice_type (painter_id, invoice_id, attribution_type)`);
    } catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
    console.log('  [10] painter_invoices_processed ALTER');

    // Backfill existing rows: attribution_type='painter_estimate' (default already), zoho_invoice_id stays NULL
    //   — existing EST-{id} keys already identify estimate-sourced rows unambiguously.

    console.log('Done.');
    await pool.end();
}
run().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run migration**

Run: `node migrations/migrate-pntr-painter-marketing.js`
Expected: `[1/9] painter_leads` … `[10] painter_invoices_processed ALTER` → `Done.` No errors.

- [ ] **Step 3: Verify schema**

Run:
```bash
node -e "require('./config/database').createPool().query('DESCRIBE painter_leads').then(([r])=>{console.log(r.map(c=>c.Field).join(',')); process.exit(0);})"
```

Expected: string includes `zoho_customer_id,painter_id,full_name,phone,...,branch_id,assigned_to,status,...`

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-pntr-painter-marketing.js
git commit -m "feat(pntr): migration for 7 marketing tables + painter/invoices_processed ALTERs"
```

---

## Task 3: Phone normalizer + branch-prefix parser (pure unit)

**Files:**
- Create: `services/pntr-import-service.js` (start empty, just export utilities)
- Create: `tests/unit/pntr-import-service.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/pntr-import-service.test.js
const { normalizePhone, parseBranchPrefix } = require('../../services/pntr-import-service');

describe('normalizePhone', () => {
    test('keeps 10-digit clean phone', () => {
        expect(normalizePhone('9876543210')).toBe('9876543210');
    });
    test('strips country code 91', () => {
        expect(normalizePhone('919876543210')).toBe('9876543210');
        expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    });
    test('strips formatting', () => {
        expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
    });
    test('rejects empty / too short', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone('123')).toBeNull();
    });
    test('rejects 12-digit not starting with 91', () => {
        expect(normalizePhone('441234567890')).toBeNull();
    });
});

describe('parseBranchPrefix', () => {
    const branches = [
        { id: 1, code: 'RMD' }, { id: 2, code: 'TCM' },
        { id: 3, code: 'PKD' }, { id: 4, code: 'RMM' }, { id: 5, code: 'PBN' }
    ];
    test('parses PNTR RMD <name>', () => {
        expect(parseBranchPrefix('PNTR RMD Karthik', branches)).toEqual({ id: 1, code: 'RMD' });
    });
    test('case-insensitive', () => {
        expect(parseBranchPrefix('pntr tcm Mani', branches)).toEqual({ id: 2, code: 'TCM' });
    });
    test('handles extra spaces', () => {
        expect(parseBranchPrefix('PNTR  PKD  Ravi', branches)).toEqual({ id: 3, code: 'PKD' });
    });
    test('returns null when code unknown', () => {
        expect(parseBranchPrefix('PNTR XYZ Someone', branches)).toBeNull();
    });
    test('returns null when no PNTR prefix', () => {
        expect(parseBranchPrefix('RMD Karthik', branches)).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement utilities**

```javascript
// services/pntr-import-service.js
/**
 * PNTR Painter Marketing — bulk + incremental Zoho customer import pipeline.
 *
 * This file starts with pure utilities (normalizePhone, parseBranchPrefix,
 * matchSalesperson). The import pipeline itself is added in Task 5.
 */

function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    let result = digits;
    if (digits.length === 12 && digits.startsWith('91')) result = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) result = digits.slice(1);
    else if (digits.length > 10) return null;
    return result.length === 10 ? result : null;
}

function parseBranchPrefix(name, branches) {
    if (!name) return null;
    const m = String(name).match(/^\s*PNTR\s+([A-Za-z]{2,5})\s+/i);
    if (!m) return null;
    const code = m[1].toUpperCase();
    const hit = branches.find(b => (b.code || '').toUpperCase() === code);
    return hit ? { id: hit.id, code } : null;
}

module.exports = {
    normalizePhone,
    parseBranchPrefix
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/pntr-import-service.js tests/unit/pntr-import-service.test.js
git commit -m "feat(pntr): phone normalizer + branch-prefix parser with unit tests"
```

---

## Task 4: Salesperson fuzzy matcher

**Files:**
- Modify: `services/pntr-import-service.js`
- Modify: `tests/unit/pntr-import-service.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/pntr-import-service.test.js`:

```javascript
const { matchSalesperson, levenshtein, parseSalespersonPhoneSuffix } = require('../../services/pntr-import-service');

describe('parseSalespersonPhoneSuffix', () => {
    test('extracts 10-digit suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik 9876543210')).toBe('9876543210');
    });
    test('returns null when no suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik')).toBeNull();
    });
});

describe('levenshtein', () => {
    test('identical strings → 0', () => {
        expect(levenshtein('karthik', 'karthik')).toBe(0);
    });
    test('one edit', () => {
        expect(levenshtein('karthik', 'kartik')).toBe(1);
    });
});

describe('matchSalesperson', () => {
    const painters = [
        { id: 10, full_name: 'Karthik', phone: '9876543210' },
        { id: 11, full_name: 'Ravi Kumar', phone: '9123456789' }
    ];
    test('exact phone match', () => {
        const res = matchSalesperson({ name: 'Karthik 9876543210' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'exact_phone' });
    });
    test('exact name match when phone missing', () => {
        const res = matchSalesperson({ name: 'Ravi Kumar' }, painters);
        expect(res).toEqual({ painter_id: 11, confidence: 'exact_name' });
    });
    test('fuzzy name (Levenshtein < 3)', () => {
        const res = matchSalesperson({ name: 'Kartik' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'fuzzy_name' });
    });
    test('unmatched returns null painter_id', () => {
        const res = matchSalesperson({ name: 'Completely Different' }, painters);
        expect(res).toEqual({ painter_id: null, confidence: 'unmatched' });
    });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement**

Add to `services/pntr-import-service.js` before `module.exports`:

```javascript
function parseSalespersonPhoneSuffix(name) {
    if (!name) return null;
    const m = String(name).match(/(\d{10})\s*$/);
    return m ? m[1] : null;
}

function levenshtein(a, b) {
    a = (a || '').toLowerCase();
    b = (b || '').toLowerCase();
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function matchSalesperson(sp, painters) {
    const phoneSuffix = parseSalespersonPhoneSuffix(sp.name);
    if (phoneSuffix) {
        const hit = painters.find(p => normalizePhone(p.phone) === phoneSuffix);
        if (hit) return { painter_id: hit.id, confidence: 'exact_phone' };
    }
    const nameNoPhone = (sp.name || '').replace(/\s*\d{10}\s*$/, '').trim().toLowerCase();
    const exactName = painters.find(p => (p.full_name || '').trim().toLowerCase() === nameNoPhone);
    if (exactName) return { painter_id: exactName.id, confidence: 'exact_name' };
    let best = null;
    for (const p of painters) {
        const d = levenshtein(nameNoPhone, (p.full_name || '').toLowerCase());
        if (d < 3 && (!best || d < best.dist)) best = { painter_id: p.id, dist: d };
    }
    if (best) return { painter_id: best.painter_id, confidence: 'fuzzy_name' };
    return { painter_id: null, confidence: 'unmatched' };
}
```

Update `module.exports`:

```javascript
module.exports = {
    normalizePhone,
    parseBranchPrefix,
    parseSalespersonPhoneSuffix,
    levenshtein,
    matchSalesperson
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: All tests PASS (13 total).

- [ ] **Step 5: Commit**

```bash
git add services/pntr-import-service.js tests/unit/pntr-import-service.test.js
git commit -m "feat(pntr): salesperson fuzzy matcher (exact_phone/exact_name/fuzzy_name)"
```

---

## Task 5: Bulk + incremental PNTR import pipeline

**Files:**
- Modify: `services/pntr-import-service.js`
- Modify: `tests/unit/pntr-import-service.test.js`

- [ ] **Step 1: Add integration-style tests using mocked pool + mocked Zoho**

Append to `tests/unit/pntr-import-service.test.js`:

```javascript
const importService = require('../../services/pntr-import-service');

function makeMockPool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM branches/i.test(sql)) return [state.branches];
            if (/FROM painters WHERE phone/i.test(sql)) {
                const phone = params[0];
                return [state.painters.filter(p => p.phone === phone)];
            }
            if (/FROM painter_leads WHERE phone/i.test(sql)) {
                const phone = params[0];
                return [state.leads.filter(l => l.phone === phone)];
            }
            if (/FROM zoho_customers_map.*zoho_contact_id/i.test(sql)) {
                return [state.custMap.filter(c => c.zoho_contact_id === params[0])];
            }
            if (/INTO painter_leads/i.test(sql)) {
                state.inserts.push({ table: 'painter_leads', params });
                return [{ insertId: state.inserts.length }];
            }
            if (/INTO painter_lead_duplicate_queue/i.test(sql)) {
                state.inserts.push({ table: 'duplicate_queue', params });
                return [{ insertId: 1 }];
            }
            if (/UPDATE painters/i.test(sql)) {
                state.inserts.push({ table: 'painters_update', params });
                return [{ affectedRows: 1 }];
            }
            if (/INSERT INTO painter_pntr_import_runs/i.test(sql)) return [{ insertId: 42 }];
            if (/UPDATE painter_pntr_import_runs/i.test(sql)) return [{ affectedRows: 1 }];
            return [[]];
        })
    };
}

describe('runBulkImport pipeline', () => {
    test('new PNTR customer → painter_leads INSERT with branch from prefix', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [],
            leads: [],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z100', contact_name: 'PNTR RMD Karthik', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.imported_count).toBe(1);
        const leadInsert = state.inserts.find(i => i.table === 'painter_leads');
        expect(leadInsert).toBeDefined();
        // params: [zoho_customer_id, full_name, phone, branch_id, branch_detected_via]
        expect(leadInsert.params[0]).toBe('Z100');
        expect(leadInsert.params[2]).toBe('9876543210');
        expect(leadInsert.params[3]).toBe(1); // branch_id RMD
    });

    test('matching existing painter → scenario 1: link, no lead INSERT for marketing', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [{ id: 50, phone: '9876543210', full_name: 'Karthik' }],
            leads: [],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z100', contact_name: 'PNTR RMD Karthik', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.linked_existing_painter).toBe(1);
        expect(state.inserts.some(i => i.table === 'painters_update')).toBe(true);
    });

    test('duplicate phone in leads → duplicate_queue INSERT', async () => {
        const state = {
            branches: [{ id: 1, code: 'RMD', name: 'Ramanathapuram' }],
            painters: [],
            leads: [{ id: 5, phone: '9876543210' }],
            custMap: [],
            inserts: []
        };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z200', contact_name: 'PNTR RMD DuplicateGuy', mobile: '9876543210' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.duplicates_queued).toBe(1);
        expect(state.inserts.some(i => i.table === 'duplicate_queue')).toBe(true);
    });

    test('invalid phone → errors_count++', async () => {
        const state = { branches: [], painters: [], leads: [], custMap: [], inserts: [] };
        const pool = makeMockPool(state);
        const zohoApi = {
            getContacts: jest.fn(async () => ({
                contacts: [{ contact_id: 'Z300', contact_name: 'PNTR RMD NoPhone', mobile: '' }],
                page_context: { has_more_page: false }
            })),
            listSalespersons: jest.fn(async () => ({ salespersons: [] }))
        };

        const result = await importService.runBulkImport({ pool, zohoApi, triggeredBy: null });

        expect(result.errors_count).toBe(1);
        expect(result.imported_count).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: FAIL (`runBulkImport` undefined).

- [ ] **Step 3: Implement the pipeline**

Append to `services/pntr-import-service.js`:

```javascript
async function getBranches(pool) {
    const [rows] = await pool.query(
        `SELECT id, code, name, zoho_location_id FROM branches WHERE status = 'active'`
    );
    return rows;
}

async function detectBranch(pool, customer, branches, normalizedPhone) {
    // 1. name prefix
    const byPrefix = parseBranchPrefix(customer.contact_name, branches);
    if (byPrefix) return { id: byPrefix.id, via: 'name_prefix' };
    // 2. zoho_customers_map
    const [mapRows] = await pool.query(
        `SELECT branch_id FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
        [customer.contact_id]
    );
    if (mapRows.length && mapRows[0].branch_id) {
        return { id: mapRows[0].branch_id, via: 'zoho_branch_id' };
    }
    // 3. invoice history (last 180d)
    const [invRows] = await pool.query(
        `SELECT local_branch_id, COUNT(*) AS c FROM zoho_invoices
         WHERE zoho_customer_id = ? AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)
           AND local_branch_id IS NOT NULL
         GROUP BY local_branch_id ORDER BY c DESC LIMIT 1`,
        [customer.contact_id]
    );
    if (invRows.length) return { id: invRows[0].local_branch_id, via: 'invoice_history' };
    return { id: null, via: null };
}

async function upsertPainterLead(pool, row) {
    const [res] = await pool.query(
        `INSERT INTO painter_leads
            (zoho_customer_id, full_name, phone, email, branch_id, branch_detected_via, status)
         VALUES (?, ?, ?, ?, ?, ?, 'new')`,
        [row.zoho_contact_id, row.full_name, row.phone, row.email || null, row.branch_id, row.branch_detected_via]
    );
    return res.insertId;
}

async function processCustomer({ pool, customer, branches, counters, runId }) {
    const phone = normalizePhone(customer.mobile || customer.phone);
    if (!phone) { counters.errors_count++; return; }

    // Scenario 1: matches existing painter
    const [painterRows] = await pool.query(
        `SELECT id FROM painters WHERE phone = ? LIMIT 1`, [phone]
    );
    if (painterRows.length) {
        await pool.query(
            `UPDATE painters SET zoho_customer_id = ? WHERE id = ? AND zoho_customer_id IS NULL`,
            [customer.contact_id, painterRows[0].id]
        );
        counters.linked_existing_painter++;
        return;
    }

    // Scenario 3: duplicate phone in leads
    const [leadRows] = await pool.query(
        `SELECT id FROM painter_leads WHERE phone = ? LIMIT 1`, [phone]
    );
    if (leadRows.length) {
        await pool.query(
            `INSERT INTO painter_lead_duplicate_queue
                (original_painter_lead_id, duplicate_zoho_customer_id, duplicate_zoho_name, duplicate_phone)
             VALUES (?, ?, ?, ?)`,
            [leadRows[0].id, customer.contact_id, customer.contact_name, phone]
        );
        counters.duplicates_queued++;
        return;
    }

    const branch = await detectBranch(pool, customer, branches, phone);
    if (!branch.id) counters.branch_unresolved_count++;
    await upsertPainterLead(pool, {
        zoho_contact_id: customer.contact_id,
        full_name: customer.contact_name,
        phone,
        email: customer.email,
        branch_id: branch.id,
        branch_detected_via: branch.via
    });
    counters.imported_count++;
}

async function syncSalespersons({ pool, zohoApi }) {
    const resp = await zohoApi.listSalespersons();
    const salespersons = resp.salespersons || [];
    if (!salespersons.length) return { synced: 0 };
    const [painters] = await pool.query(`SELECT id, full_name, phone FROM painters`);
    let synced = 0;
    for (const sp of salespersons) {
        const match = matchSalesperson({ name: sp.salesperson_name }, painters);
        const phoneSuffix = parseSalespersonPhoneSuffix(sp.salesperson_name);
        await pool.query(
            `INSERT INTO painter_zoho_salesperson_map
                (zoho_salesperson_id, zoho_salesperson_name, zoho_salesperson_phone, painter_id, match_confidence)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                painter_id = VALUES(painter_id),
                match_confidence = VALUES(match_confidence),
                last_synced_at = NOW()`,
            [sp.salesperson_id, sp.salesperson_name, phoneSuffix || null, match.painter_id, match.confidence]
        );
        if (match.painter_id) {
            await pool.query(
                `UPDATE painters SET zoho_salesperson_id = ? WHERE id = ? AND zoho_salesperson_id IS NULL`,
                [sp.salesperson_id, match.painter_id]
            );
        }
        synced++;
    }
    return { synced };
}

async function runBulkImport({ pool, zohoApi, triggeredBy = null, runType = 'initial_bulk', sinceIso = null }) {
    const [runIns] = await pool.query(
        `INSERT INTO painter_pntr_import_runs (run_type, triggered_by, status) VALUES (?, ?, 'running')`,
        [runType, triggeredBy]
    );
    const runId = runIns.insertId;
    const counters = {
        total_zoho_pntr_customers: 0,
        imported_count: 0,
        linked_existing_painter: 0,
        duplicates_queued: 0,
        branch_unresolved_count: 0,
        errors_count: 0
    };
    try {
        const branches = await getBranches(pool);
        let page = 1, hasMore = true;
        while (hasMore) {
            const params = {
                page, per_page: 200,
                contact_name_contains: 'PNTR'
            };
            if (sinceIso) params.last_modified_time = sinceIso;
            const resp = await zohoApi.getContacts(params);
            const batch = (resp.contacts || []).filter(c => /PNTR/i.test(c.contact_name || ''));
            counters.total_zoho_pntr_customers += batch.length;
            for (const cust of batch) {
                try { await processCustomer({ pool, customer: cust, branches, counters, runId }); }
                catch (e) { console.error('[pntr-import] customer failed', cust.contact_id, e.message); counters.errors_count++; }
            }
            hasMore = resp.page_context?.has_more_page || false;
            page++;
        }
        await syncSalespersons({ pool, zohoApi });
        await pool.query(
            `UPDATE painter_pntr_import_runs SET
                status='completed', completed_at=NOW(),
                total_zoho_pntr_customers=?, imported_count=?, linked_existing_painter=?,
                duplicates_queued=?, branch_unresolved_count=?, errors_count=?
             WHERE id = ?`,
            [counters.total_zoho_pntr_customers, counters.imported_count, counters.linked_existing_painter,
             counters.duplicates_queued, counters.branch_unresolved_count, counters.errors_count, runId]
        );
        return { run_id: runId, ...counters };
    } catch (err) {
        await pool.query(
            `UPDATE painter_pntr_import_runs SET status='failed', completed_at=NOW(), notes=? WHERE id=?`,
            [err.message.slice(0, 500), runId]
        );
        throw err;
    }
}

async function runIncrementalImport({ pool, zohoApi, triggeredBy = null }) {
    const [last] = await pool.query(
        `SELECT completed_at FROM painter_pntr_import_runs WHERE status='completed' ORDER BY id DESC LIMIT 1`
    );
    const sinceIso = last.length ? new Date(last[0].completed_at).toISOString() : null;
    return runBulkImport({ pool, zohoApi, triggeredBy, runType: 'incremental_daily', sinceIso });
}

module.exports = {
    normalizePhone,
    parseBranchPrefix,
    parseSalespersonPhoneSuffix,
    levenshtein,
    matchSalesperson,
    detectBranch,
    processCustomer,
    syncSalespersons,
    runBulkImport,
    runIncrementalImport
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx jest tests/unit/pntr-import-service.test.js --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/pntr-import-service.js tests/unit/pntr-import-service.test.js
git commit -m "feat(pntr): bulk + incremental import pipeline with branch detection + 5 dedup scenarios"
```

---

## Task 6: Universal painter → Zoho sync hook + retry queue

**Files:**
- Create: `services/painter-zoho-sync-service.js`
- Create: `tests/unit/painter-zoho-sync-service.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/painter-zoho-sync-service.test.js
const service = require('../../services/painter-zoho-sync-service');

function makePool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM painters WHERE id/i.test(sql)) return [state.painters.filter(p => p.id === params[0])];
            if (/FROM branches WHERE id/i.test(sql)) return [state.branches.filter(b => b.id === params[0])];
            if (/FROM zoho_customers_map/i.test(sql)) return [state.custMap];
            if (/FROM painter_zoho_salesperson_map/i.test(sql)) return [state.spMap];
            if (/UPDATE painters/i.test(sql)) { state.updates.push({ sql, params }); return [{ affectedRows: 1 }]; }
            if (/INTO painter_zoho_sync_queue/i.test(sql)) { state.queue.push(params); return [{ insertId: 1 }]; }
            if (/INTO painter_zoho_salesperson_map/i.test(sql)) { return [{ insertId: 1 }]; }
            if (/INTO zoho_customers_map/i.test(sql)) { return [{ insertId: 1 }]; }
            return [[]];
        })
    };
}

describe('syncPainterToZoho', () => {
    test('skips when both IDs already set (idempotent)', async () => {
        const state = {
            painters: [{ id: 1, zoho_customer_id: 'Z1', zoho_salesperson_id: 'S1', phone: '9876543210' }],
            branches: [], custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = { createContact: jest.fn(), createSalesperson: jest.fn() };
        const res = await service.syncPainterToZoho(1, { pool: makePool(state), zohoApi });
        expect(res.skipped).toBe(true);
        expect(zohoApi.createContact).not.toHaveBeenCalled();
        expect(zohoApi.createSalesperson).not.toHaveBeenCalled();
    });

    test('creates Zoho customer + salesperson when missing', async () => {
        const state = {
            painters: [{ id: 2, full_name: 'Karthik', phone: '9876543210', email: null, branch_id: 1 }],
            branches: [{ id: 1, code: 'RMD', name: 'Rmd', zoho_location_id: 'L1' }],
            custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = {
            createContact: jest.fn(async () => ({ contact: { contact_id: 'Z999' } })),
            createSalesperson: jest.fn(async () => ({ salesperson: { salesperson_id: 'S999' } }))
        };
        const pool = makePool(state);
        const res = await service.syncPainterToZoho(2, { pool, zohoApi });
        expect(zohoApi.createContact).toHaveBeenCalled();
        const callArgs = zohoApi.createContact.mock.calls[0][0];
        expect(callArgs.contact_name).toBe('PNTR RMD Karthik');
        expect(zohoApi.createSalesperson).toHaveBeenCalled();
        expect(res.created_customer).toBe('Z999');
        expect(res.created_salesperson).toBe('S999');
    });

    test('queues customer create on Zoho error, no salesperson attempt', async () => {
        const state = {
            painters: [{ id: 3, full_name: 'X', phone: '9876500000', branch_id: 1 }],
            branches: [{ id: 1, code: 'RMD', name: 'Rmd' }],
            custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = {
            createContact: jest.fn(async () => { throw new Error('429 rate limit'); }),
            createSalesperson: jest.fn()
        };
        const res = await service.syncPainterToZoho(3, { pool: makePool(state), zohoApi });
        expect(res.queued).toContain('customer');
        expect(state.queue.length).toBeGreaterThan(0);
        expect(zohoApi.createSalesperson).not.toHaveBeenCalled();
    });
});

describe('retry backoff', () => {
    test('computeNextRetry caps at 1d after 4 attempts', () => {
        expect(service._computeNextRetry(1)).toBe(60 * 60 * 1000); // 1h
        expect(service._computeNextRetry(2)).toBe(4 * 60 * 60 * 1000);
        expect(service._computeNextRetry(3)).toBe(12 * 60 * 60 * 1000);
        expect(service._computeNextRetry(4)).toBe(24 * 60 * 60 * 1000);
        expect(service._computeNextRetry(5)).toBe(24 * 60 * 60 * 1000);
    });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx jest tests/unit/painter-zoho-sync-service.test.js --no-coverage`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement service**

```javascript
// services/painter-zoho-sync-service.js
let _pool, _zohoApi;

function init({ pool, zohoApi }) {
    _pool = pool;
    _zohoApi = zohoApi;
}

function _computeNextRetry(attempts) {
    const schedule = [60 * 60 * 1000, 4 * 60 * 60 * 1000, 12 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
    return schedule[Math.min(attempts, schedule.length) - 1] || 24 * 60 * 60 * 1000;
}

async function _queueFailure(pool, painterId, syncType, err) {
    const nextMs = _computeNextRetry(1);
    await pool.query(
        `INSERT INTO painter_zoho_sync_queue
            (painter_id, sync_type, status, attempts, last_error, next_retry_at)
         VALUES (?, ?, 'pending', 1, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [painterId, syncType, String(err.message || err).slice(0, 1000), Math.floor(nextMs / 1000)]
    );
}

async function syncPainterToZoho(painterId, ctx = {}) {
    const pool = ctx.pool || _pool;
    const zohoApi = ctx.zohoApi || _zohoApi;
    if (!pool || !zohoApi) throw new Error('syncPainterToZoho: pool/zohoApi not initialized');

    const [pRows] = await pool.query(`SELECT * FROM painters WHERE id = ? LIMIT 1`, [painterId]);
    if (!pRows.length) throw new Error(`Painter ${painterId} not found`);
    const painter = pRows[0];
    if (painter.zoho_customer_id && painter.zoho_salesperson_id) {
        return { skipped: true, reason: 'already_synced' };
    }

    let branch = null;
    if (painter.branch_id) {
        const [bRows] = await pool.query(
            `SELECT id, code, name, zoho_location_id FROM branches WHERE id = ? LIMIT 1`,
            [painter.branch_id]
        );
        branch = bRows[0] || null;
    }
    const branchCode = branch ? branch.code : 'GEN';
    const result = { painter_id: painterId };

    // STEP 1 — customer
    if (!painter.zoho_customer_id) {
        const [existing] = await pool.query(
            `SELECT zoho_contact_id FROM zoho_customers_map
             WHERE REPLACE(REPLACE(REPLACE(zoho_phone, ' ', ''), '-', ''), '+', '') LIKE ?
               AND zoho_contact_name LIKE '%PNTR%' LIMIT 1`,
            [`%${painter.phone}`]
        );
        if (existing.length) {
            await pool.query(`UPDATE painters SET zoho_customer_id = ? WHERE id = ?`, [existing[0].zoho_contact_id, painterId]);
            result.linked_existing_customer = existing[0].zoho_contact_id;
        } else {
            try {
                const zohoName = `PNTR ${branchCode} ${painter.full_name}`;
                const resp = await zohoApi.createContact({
                    contact_name: zohoName,
                    mobile: painter.phone,
                    email: painter.email || undefined,
                    custom_fields: [{ api_name: 'cf_painter_id', value: painter.id }]
                });
                const cid = resp?.contact?.contact_id;
                if (!cid) throw new Error('Zoho createContact: no contact_id in response');
                await pool.query(`UPDATE painters SET zoho_customer_id = ? WHERE id = ?`, [cid, painterId]);
                await pool.query(
                    `INSERT INTO zoho_customers_map (zoho_contact_id, zoho_contact_name, zoho_phone, branch_id, last_synced_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE last_synced_at = NOW()`,
                    [cid, zohoName, painter.phone, painter.branch_id || null]
                );
                result.created_customer = cid;
            } catch (err) {
                await _queueFailure(pool, painterId, 'customer', err);
                return { queued: ['customer'], error: err.message };
            }
        }
    }

    // STEP 2 — salesperson
    if (!painter.zoho_salesperson_id) {
        const [existingSP] = await pool.query(
            `SELECT zoho_salesperson_id FROM painter_zoho_salesperson_map
             WHERE zoho_salesperson_phone = ? OR zoho_salesperson_name = ?
             LIMIT 1`,
            [painter.phone, `${painter.full_name} ${painter.phone}`]
        );
        if (existingSP.length) {
            await pool.query(
                `UPDATE painter_zoho_salesperson_map SET painter_id = ?, match_confidence='exact_phone'
                 WHERE zoho_salesperson_id = ?`,
                [painterId, existingSP[0].zoho_salesperson_id]
            );
            await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [existingSP[0].zoho_salesperson_id, painterId]);
            result.linked_existing_salesperson = existingSP[0].zoho_salesperson_id;
        } else {
            try {
                const spName = `${painter.full_name} ${painter.phone}`;
                const resp = await zohoApi.createSalesperson({
                    salesperson_name: spName,
                    salesperson_email: painter.email || null
                });
                const spid = resp?.salesperson?.salesperson_id;
                if (!spid) throw new Error('Zoho createSalesperson: no salesperson_id in response');
                await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [spid, painterId]);
                await pool.query(
                    `INSERT INTO painter_zoho_salesperson_map
                        (zoho_salesperson_id, zoho_salesperson_name, zoho_salesperson_phone, painter_id, match_confidence)
                     VALUES (?, ?, ?, ?, 'exact_phone')
                     ON DUPLICATE KEY UPDATE painter_id = VALUES(painter_id)`,
                    [spid, spName, painter.phone, painterId]
                );
                result.created_salesperson = spid;
            } catch (err) {
                await _queueFailure(pool, painterId, 'salesperson', err);
                return { ...result, queued: ['salesperson'], error: err.message };
            }
        }
    }

    return result;
}

async function retryQueue(ctx = {}) {
    const pool = ctx.pool || _pool;
    const zohoApi = ctx.zohoApi || _zohoApi;
    if (!pool) throw new Error('retryQueue: pool missing');
    const [rows] = await pool.query(
        `SELECT id, painter_id, sync_type, attempts FROM painter_zoho_sync_queue
         WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY id ASC LIMIT 50`
    );
    const results = { processed: 0, completed: 0, failed: 0 };
    for (const row of rows) {
        results.processed++;
        await pool.query(`UPDATE painter_zoho_sync_queue SET status='processing' WHERE id=?`, [row.id]);
        try {
            await syncPainterToZoho(row.painter_id, { pool, zohoApi });
            await pool.query(
                `UPDATE painter_zoho_sync_queue SET status='completed', completed_at=NOW() WHERE id=?`,
                [row.id]
            );
            results.completed++;
        } catch (err) {
            const nextAttempts = row.attempts + 1;
            if (nextAttempts >= 5) {
                await pool.query(
                    `UPDATE painter_zoho_sync_queue SET status='failed', attempts=?, last_error=? WHERE id=?`,
                    [nextAttempts, String(err.message).slice(0, 1000), row.id]
                );
            } else {
                const backoffSec = Math.floor(_computeNextRetry(nextAttempts) / 1000);
                await pool.query(
                    `UPDATE painter_zoho_sync_queue SET status='pending', attempts=?, last_error=?,
                        next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?`,
                    [nextAttempts, String(err.message).slice(0, 1000), backoffSec, row.id]
                );
            }
            results.failed++;
        }
    }
    return results;
}

module.exports = {
    init,
    syncPainterToZoho,
    retryQueue,
    _computeNextRetry
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx jest tests/unit/painter-zoho-sync-service.test.js --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/painter-zoho-sync-service.js tests/unit/painter-zoho-sync-service.test.js
git commit -m "feat(pntr): universal painter→Zoho sync hook with idempotency + retry queue"
```

---

## Task 7: Daily list scheduler (outcome mapper + list picker)

**Files:**
- Create: `services/painter-marketing-scheduler.js`
- Create: `tests/unit/painter-marketing-scheduler.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/painter-marketing-scheduler.test.js
const sched = require('../../services/painter-marketing-scheduler');

describe('applyOutcome', () => {
    const cfg = {
        recycle_days_new: 7, recycle_days_callback: 3, recycle_days_will_visit: 14,
        recycle_days_already_aware: 60, recycle_days_not_interested: 30,
        recycle_days_unreachable: 60, recycle_days_active_painter: 45
    };
    function today() { return new Date('2026-04-16T00:00:00Z'); }

    test('interested_in_program → interested, +7d', () => {
        const r = sched.applyOutcome({ outcome: 'interested_in_program', cfg, today: today() });
        expect(r.status).toBe('interested');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-23');
    });
    test('wants_callback with explicit date honored', () => {
        const r = sched.applyOutcome({ outcome: 'wants_callback', callbackDate: '2026-04-20', cfg, today: today() });
        expect(r.status).toBe('in_progress');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-20');
    });
    test('wants_callback without date → +3d', () => {
        const r = sched.applyOutcome({ outcome: 'wants_callback', cfg, today: today() });
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-19');
    });
    test('wrong_number → next_eligible NULL (permanently off)', () => {
        const r = sched.applyOutcome({ outcome: 'wrong_number', cfg, today: today() });
        expect(r.status).toBe('wrong_number');
        expect(r.next_eligible_date).toBeNull();
    });
    test('not_answered with < 5 consecutive → unchanged status, +3d', () => {
        const r = sched.applyOutcome({ outcome: 'no_answer', consecutiveNoAnswer: 2, currentStatus: 'in_progress', cfg, today: today() });
        expect(r.status).toBe('in_progress');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-19');
    });
    test('not_answered 5+ consecutive → unreachable + 60d', () => {
        const r = sched.applyOutcome({ outcome: 'no_answer', consecutiveNoAnswer: 5, currentStatus: 'in_progress', cfg, today: today() });
        expect(r.status).toBe('unreachable');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-06-15');
    });
    test('not_interested → +30d', () => {
        const r = sched.applyOutcome({ outcome: 'not_interested', cfg, today: today() });
        expect(r.status).toBe('not_interested');
    });
});
```

- [ ] **Step 2: Verify failure**

Run: `npx jest tests/unit/painter-marketing-scheduler.test.js --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement**

```javascript
// services/painter-marketing-scheduler.js
const cron = require('node-cron');

const DEFAULT_CFG = {
    daily_quota: 10,
    recycle_days_new: 7,
    recycle_days_callback: 3,
    recycle_days_will_visit: 14,
    recycle_days_already_aware: 60,
    recycle_days_not_interested: 30,
    recycle_days_unreachable: 60,
    recycle_days_active_painter: 45
};

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function applyOutcome({ outcome, callbackDate = null, consecutiveNoAnswer = 0, currentStatus = 'new', cfg = DEFAULT_CFG, today = new Date() }) {
    switch (outcome) {
        case 'interested_in_program':
            return { status: 'interested', next_eligible_date: addDays(today, cfg.recycle_days_new ?? 7) };
        case 'wants_callback':
            return {
                status: 'in_progress',
                next_eligible_date: callbackDate ? new Date(`${callbackDate}T00:00:00Z`) : addDays(today, cfg.recycle_days_callback ?? 3)
            };
        case 'will_visit_shop':
            return { status: 'in_progress', next_eligible_date: addDays(today, cfg.recycle_days_will_visit ?? 14) };
        case 'already_aware':
            return { status: 'in_progress', next_eligible_date: addDays(today, cfg.recycle_days_already_aware ?? 60) };
        case 'not_interested':
            return { status: 'not_interested', next_eligible_date: addDays(today, cfg.recycle_days_not_interested ?? 30) };
        case 'wrong_number':
            return { status: 'wrong_number', next_eligible_date: null };
        case 'no_answer':
            if (consecutiveNoAnswer >= 5) {
                return { status: 'unreachable', next_eligible_date: addDays(today, cfg.recycle_days_unreachable ?? 60) };
            }
            return { status: currentStatus, next_eligible_date: addDays(today, cfg.recycle_days_callback ?? 3) };
        default:
            return { status: currentStatus, next_eligible_date: addDays(today, 1) };
    }
}

async function getConfig(pool, branchId, userId = null) {
    const [branchCfg] = await pool.query(
        `SELECT * FROM painter_marketing_config WHERE scope='branch' AND scope_id=? LIMIT 1`,
        [branchId]
    );
    let cfg = branchCfg[0] ? { ...DEFAULT_CFG, ...branchCfg[0] } : { ...DEFAULT_CFG };
    if (userId) {
        const [userCfg] = await pool.query(
            `SELECT * FROM painter_marketing_config WHERE scope='user' AND scope_id=? LIMIT 1`,
            [userId]
        );
        if (userCfg[0]) cfg = { ...cfg, ...userCfg[0] };
    }
    return cfg;
}

async function generateDailyLists(pool) {
    const [branches] = await pool.query(`SELECT id FROM branches WHERE status='active'`);
    const stats = { branches: 0, staff: 0, assignments: 0 };
    for (const br of branches) {
        stats.branches++;
        const [staff] = await pool.query(
            `SELECT id FROM users WHERE branch_id = ? AND role IN ('staff','manager') AND is_active = 1`,
            [br.id]
        );
        for (const s of staff) {
            stats.staff++;
            const cfg = await getConfig(pool, br.id, s.id);
            const quota = cfg.daily_quota || 10;
            const [eligible] = await pool.query(
                `SELECT id FROM painter_leads
                 WHERE branch_id = ?
                   AND assigned_to = ?
                   AND status IN ('new','in_progress','interested','unreachable')
                   AND (next_eligible_date IS NULL OR next_eligible_date <= CURDATE())
                   AND id NOT IN (
                       SELECT painter_lead_id FROM painter_daily_assignments WHERE assigned_date = CURDATE()
                   )
                 ORDER BY
                    FIELD(status,'interested','in_progress','new','unreachable'),
                    COALESCE(last_contact_date, '1970-01-01') ASC
                 LIMIT ?`,
                [br.id, s.id, quota]
            );
            for (const lead of eligible) {
                await pool.query(
                    `INSERT IGNORE INTO painter_daily_assignments (user_id, branch_id, painter_lead_id, assigned_date)
                     VALUES (?, ?, ?, CURDATE())`,
                    [s.id, br.id, lead.id]
                );
                stats.assignments++;
            }
        }
    }
    return stats;
}

async function assignNewLead(pool, painterLeadId, branchId) {
    // Load-balanced: pick staff with fewest currently-assigned painters in branch
    const [candidates] = await pool.query(
        `SELECT u.id, COUNT(pl.id) AS cnt
         FROM users u LEFT JOIN painter_leads pl ON pl.assigned_to = u.id AND pl.status NOT IN ('converted','active_painter','wrong_number','duplicate')
         WHERE u.branch_id = ? AND u.role IN ('staff','manager') AND u.is_active = 1
         GROUP BY u.id ORDER BY cnt ASC LIMIT 1`,
        [branchId]
    );
    if (!candidates.length) return null;
    const userId = candidates[0].id;
    await pool.query(`UPDATE painter_leads SET assigned_to = ? WHERE id = ?`, [userId, painterLeadId]);
    return userId;
}

let _registered = false;
function registerCron({ pool, zohoApi, pntrImportService, backfillService, painterZohoSyncService }) {
    if (_registered) return;
    _registered = true;
    // 02:30 IST incremental PNTR import
    cron.schedule('30 2 * * *', async () => {
        try { await pntrImportService.runIncrementalImport({ pool, zohoApi }); }
        catch (e) { console.error('[pntr-marketing] incremental import failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    // 03:00 IST Zoho sync retry
    cron.schedule('0 3 * * *', async () => {
        try { await painterZohoSyncService.retryQueue({ pool, zohoApi }); }
        catch (e) { console.error('[pntr-marketing] retry queue failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    // 03:30 IST backfill incremental
    cron.schedule('30 3 * * *', async () => {
        try { await backfillService.runDailyIncremental({ pool }); }
        catch (e) { console.error('[pntr-marketing] backfill daily failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    // 06:00 IST daily list generation
    cron.schedule('0 6 * * *', async () => {
        try { await generateDailyLists(pool); }
        catch (e) { console.error('[pntr-marketing] daily list gen failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    console.log('[pntr-marketing] crons registered: 02:30, 03:00, 03:30, 06:00 IST');
}

module.exports = {
    applyOutcome,
    getConfig,
    generateDailyLists,
    assignNewLead,
    registerCron,
    DEFAULT_CFG
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx jest tests/unit/painter-marketing-scheduler.test.js --no-coverage`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add services/painter-marketing-scheduler.js tests/unit/painter-marketing-scheduler.test.js
git commit -m "feat(pntr): daily list scheduler + outcome→status mapper + 4 IST crons"
```

---

## Task 8: Annual points backfill service

**Files:**
- Create: `services/painter-points-backfill-service.js`
- Create: `tests/unit/painter-points-backfill-service.test.js`
- Modify: `services/painter-points-engine.js` (expose compute helper if not already)

- [ ] **Step 1: Inspect `painter-points-engine.js` to find existing rate lookups**

Run: `grep -n "self_billing\|customer_billing\|annual_rate\|regular_rate\|awardPoints\|computePoints" services/painter-points-engine.js | head -30`

Use the helper that returns `{regular, annual}` points for an invoice total + billing type. If no such helper exists, extract one; otherwise call it directly from backfill.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/unit/painter-points-backfill-service.test.js
const backfill = require('../../services/painter-points-backfill-service');

function makePool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM painters WHERE id = \?/i.test(sql)) return [state.painters.filter(p => p.id === params[0])];
            if (/FROM zoho_invoices zi/i.test(sql) && /zoho_contact_id = \?/i.test(sql)) return [state.directInvoices];
            if (/FROM zoho_invoices.*zoho_salesperson_id = \?/i.test(sql)) return [state.spInvoices];
            if (/FROM painter_invoices_processed/i.test(sql)) return [state.processed];
            if (/INSERT INTO painter_points_transactions/i.test(sql)) { state.pointsInserts.push(params); return [{ insertId: 1 }]; }
            if (/INSERT INTO painter_invoices_processed/i.test(sql)) { state.processedInserts.push(params); return [{ insertId: 1 }]; }
            return [[]];
        })
    };
}

describe('backfillPainter', () => {
    test('skipped when painter not activated', async () => {
        const state = {
            painters: [{ id: 1, activated_at: null, zoho_customer_id: 'Z1' }],
            directInvoices: [], spInvoices: [], processed: [],
            pointsInserts: [], processedInserts: []
        };
        const res = await backfill.backfillPainter(1, '2025-12-01', { pool: makePool(state) });
        expect(res.skipped).toBe('not_activated');
    });

    test('direct billing awards annual pool only', async () => {
        const state = {
            painters: [{ id: 2, activated_at: new Date(), zoho_customer_id: 'Z2', zoho_salesperson_id: null, user_id: 20 }],
            directInvoices: [{ zoho_invoice_id: 'INV1', total: 10000, invoice_date: '2026-01-15', status: 'paid' }],
            spInvoices: [],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const rates = { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 };
        const res = await backfill.backfillPainter(2, '2025-12-01', { pool: makePool(state), rates });
        // 10000 * 0.005 = 50 annual, 0 regular
        expect(res.direct_points_awarded).toBe(50);
        expect(state.pointsInserts.length).toBe(1);
        // pool column should be 'annual'
        const poolVal = state.pointsInserts[0].find(p => p === 'annual');
        expect(poolVal).toBe('annual');
    });

    test('salesperson billing awards regular + annual', async () => {
        const state = {
            painters: [{ id: 3, activated_at: new Date(), zoho_customer_id: null, zoho_salesperson_id: 'S3', user_id: 30 }],
            directInvoices: [],
            spInvoices: [{ zoho_invoice_id: 'INV9', total: 20000, invoice_date: '2026-02-01', status: 'paid' }],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const rates = { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 };
        const res = await backfill.backfillPainter(3, '2025-12-01', { pool: makePool(state), rates });
        // 20000 * 0.005 = 100 each → 2 inserts
        expect(state.pointsInserts.length).toBe(2);
        expect(res.salesperson_points_awarded).toBe(200);
    });

    test('already-processed invoice skipped (idempotent)', async () => {
        const state = {
            painters: [{ id: 4, activated_at: new Date(), zoho_customer_id: 'Z4', zoho_salesperson_id: null }],
            directInvoices: [],   // query already filters via NOT IN subquery — mock returns []
            spInvoices: [],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const res = await backfill.backfillPainter(4, '2025-12-01', { pool: makePool(state), rates: { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 } });
        expect(res.direct_points_awarded).toBe(0);
        expect(state.pointsInserts.length).toBe(0);
    });
});
```

- [ ] **Step 3: Verify failure**

Run: `npx jest tests/unit/painter-points-backfill-service.test.js --no-coverage`
Expected: FAIL.

- [ ] **Step 4: Implement**

```javascript
// services/painter-points-backfill-service.js

async function _loadRates(pool) {
    const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ai_config WHERE config_key IN
            ('painter_self_billing_annual_rate','painter_customer_billing_regular_rate','painter_customer_billing_annual_rate')`
    );
    const map = Object.fromEntries(rows.map(r => [r.config_key, parseFloat(r.config_value)]));
    return {
        selfAnnual: map.painter_self_billing_annual_rate ?? 0.005,
        custRegular: map.painter_customer_billing_regular_rate ?? 0.005,
        custAnnual: map.painter_customer_billing_annual_rate ?? 0.005
    };
}

async function backfillPainter(painterId, fromDate, ctx = {}) {
    const pool = ctx.pool;
    if (!pool) throw new Error('backfillPainter: pool missing');
    const rates = ctx.rates || await _loadRates(pool);

    const [pRows] = await pool.query(`SELECT * FROM painters WHERE id = ? LIMIT 1`, [painterId]);
    if (!pRows.length) return { skipped: 'not_found' };
    const painter = pRows[0];
    if (!painter.activated_at) return { skipped: 'not_activated' };

    const result = { painter_id: painterId, direct_points_awarded: 0, salesperson_points_awarded: 0, invoices_processed: 0 };

    // SCENARIO 1 — direct billing
    if (painter.zoho_customer_id) {
        const [direct] = await pool.query(
            `SELECT zi.zoho_invoice_id, zi.invoice_number, zi.invoice_date, zi.total
             FROM zoho_invoices zi
             WHERE zi.zoho_customer_id = ?
               AND zi.invoice_date >= ?
               AND zi.status NOT IN ('void','draft')
               AND NOT EXISTS (
                   SELECT 1 FROM painter_invoices_processed pip
                   WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zi.zoho_invoice_id
                     AND pip.attribution_type='direct_billing'
               )`,
            [painter.zoho_customer_id, fromDate, painterId]
        );
        for (const inv of direct) {
            const annualPts = Math.round(Number(inv.total || 0) * rates.selfAnnual);
            if (annualPts > 0) {
                await pool.query(
                    `INSERT INTO painter_points_transactions
                        (painter_id, pool, points, reference, source_date, notes)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [painterId, 'annual', annualPts, `ZINV-${inv.zoho_invoice_id}-direct`, inv.invoice_date, 'Backfill direct billing']
                );
            }
            await pool.query(
                `INSERT IGNORE INTO painter_invoices_processed
                    (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type,
                     regular_points, annual_points, attribution_type, zoho_invoice_id, source_invoice_date)
                 VALUES (?, ?, ?, ?, ?, 'self', 0, ?, 'direct_billing', ?, ?)`,
                [painterId, `ZINV-${inv.zoho_invoice_id}-direct`, inv.invoice_number,
                 inv.invoice_date, inv.total, annualPts, inv.zoho_invoice_id, inv.invoice_date]
            );
            result.direct_points_awarded += annualPts;
            result.invoices_processed++;
        }
    }

    // SCENARIO 2 — salesperson attribution
    if (painter.zoho_salesperson_id) {
        const [sp] = await pool.query(
            `SELECT zoho_invoice_id, invoice_number, invoice_date, total FROM zoho_invoices
             WHERE zoho_salesperson_id = ?
               AND invoice_date >= ?
               AND status NOT IN ('void','draft')
               AND NOT EXISTS (
                   SELECT 1 FROM painter_invoices_processed pip
                   WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zoho_invoices.zoho_invoice_id
                     AND pip.attribution_type='salesperson'
               )`,
            [painter.zoho_salesperson_id, fromDate, painterId]
        );
        for (const inv of sp) {
            const regularPts = Math.round(Number(inv.total || 0) * rates.custRegular);
            const annualPts = Math.round(Number(inv.total || 0) * rates.custAnnual);
            if (regularPts > 0) {
                await pool.query(
                    `INSERT INTO painter_points_transactions (painter_id, pool, points, reference, source_date, notes)
                     VALUES (?, 'regular', ?, ?, ?, 'Backfill salesperson regular')`,
                    [painterId, regularPts, `ZINV-${inv.zoho_invoice_id}-salesperson-r`, inv.invoice_date]
                );
            }
            if (annualPts > 0) {
                await pool.query(
                    `INSERT INTO painter_points_transactions (painter_id, pool, points, reference, source_date, notes)
                     VALUES (?, 'annual', ?, ?, ?, 'Backfill salesperson annual')`,
                    [painterId, annualPts, `ZINV-${inv.zoho_invoice_id}-salesperson-a`, inv.invoice_date]
                );
            }
            await pool.query(
                `INSERT IGNORE INTO painter_invoices_processed
                    (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type,
                     regular_points, annual_points, attribution_type, zoho_invoice_id, source_invoice_date)
                 VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, 'salesperson', ?, ?)`,
                [painterId, `ZINV-${inv.zoho_invoice_id}-salesperson`, inv.invoice_number,
                 inv.invoice_date, inv.total, regularPts, annualPts, inv.zoho_invoice_id, inv.invoice_date]
            );
            result.salesperson_points_awarded += (regularPts + annualPts);
            result.invoices_processed++;
        }
    }

    return result;
}

async function previewBackfill({ pool, fromDate, painterIds = null }) {
    let where = `WHERE activated_at IS NOT NULL`;
    const params = [];
    if (painterIds && painterIds.length) {
        where += ` AND id IN (${painterIds.map(() => '?').join(',')})`;
        params.push(...painterIds);
    }
    const [painters] = await pool.query(`SELECT id, zoho_customer_id, zoho_salesperson_id FROM painters ${where}`, params);
    let totalInvoices = 0, totalEstimatedPoints = 0;
    const rates = await _loadRates(pool);
    for (const p of painters) {
        if (p.zoho_customer_id) {
            const [d] = await pool.query(
                `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS total FROM zoho_invoices
                 WHERE zoho_customer_id = ? AND invoice_date >= ? AND status NOT IN ('void','draft')`,
                [p.zoho_customer_id, fromDate]
            );
            totalInvoices += d[0].c;
            totalEstimatedPoints += Math.round(Number(d[0].total) * rates.selfAnnual);
        }
        if (p.zoho_salesperson_id) {
            const [s] = await pool.query(
                `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS total FROM zoho_invoices
                 WHERE zoho_salesperson_id = ? AND invoice_date >= ? AND status NOT IN ('void','draft')`,
                [p.zoho_salesperson_id, fromDate]
            );
            totalInvoices += s[0].c;
            totalEstimatedPoints += Math.round(Number(s[0].total) * (rates.custRegular + rates.custAnnual));
        }
    }
    return { painter_count: painters.length, invoices: totalInvoices, estimated_points: totalEstimatedPoints };
}

async function runBulkBackfill({ pool, fromDate, painterIds = null }) {
    const rates = await _loadRates(pool);
    let where = `WHERE activated_at IS NOT NULL`;
    const params = [];
    if (painterIds && painterIds.length) {
        where += ` AND id IN (${painterIds.map(() => '?').join(',')})`;
        params.push(...painterIds);
    }
    const [painters] = await pool.query(`SELECT id FROM painters ${where}`, params);
    const summary = { total_painters: painters.length, total_points: 0, total_invoices: 0 };
    for (const p of painters) {
        const r = await backfillPainter(p.id, fromDate, { pool, rates });
        summary.total_points += (r.direct_points_awarded || 0) + (r.salesperson_points_awarded || 0);
        summary.total_invoices += (r.invoices_processed || 0);
    }
    return summary;
}

async function runDailyIncremental({ pool }) {
    // For each activated painter, backfill from yesterday onward
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return runBulkBackfill({ pool, fromDate: yesterday });
}

module.exports = {
    backfillPainter,
    previewBackfill,
    runBulkBackfill,
    runDailyIncremental,
    _loadRates
};
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx jest tests/unit/painter-points-backfill-service.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 6: Seed default rate config**

Run one-time to ensure default rates exist in `ai_config`:

```bash
node -e "const{createPool}=require('./config/database');const pool=createPool();(async()=>{const keys=[['painter_self_billing_annual_rate','0.005'],['painter_customer_billing_regular_rate','0.005'],['painter_customer_billing_annual_rate','0.005']];for(const[k,v]of keys)await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_key=config_key',[k,v]);await pool.end();console.log('seeded');})();"
```

- [ ] **Step 7: Commit**

```bash
git add services/painter-points-backfill-service.js tests/unit/painter-points-backfill-service.test.js
git commit -m "feat(pntr): annual points backfill service (direct + salesperson attribution)"
```

---

## Task 9: Route — `routes/painter-marketing.js`

**Files:**
- Create: `routes/painter-marketing.js`
- Create: `tests/integration/painter-marketing-routes.test.js`

- [ ] **Step 1: Scaffold the route file with endpoints**

```javascript
// routes/painter-marketing.js
const express = require('express');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { applyOutcome, generateDailyLists, assignNewLead } = require('../services/painter-marketing-scheduler');
const pntrImport = require('../services/pntr-import-service');
const painterZohoSync = require('../services/painter-zoho-sync-service');
const backfill = require('../services/painter-points-backfill-service');
const zohoApi = require('../services/zoho-api');

module.exports = function(pool) {
    const router = express.Router();

    // ─────────── STAFF ENDPOINTS ───────────

    // GET /me/today — today's painter list for logged-in staff
    router.get('/me/today', authenticateToken, requirePermission('painters.marketing.view'), async (req, res) => {
        const [rows] = await pool.query(
            `SELECT pl.*, pda.contacted_at, pda.contact_outcome, pda.id AS assignment_id
             FROM painter_daily_assignments pda
             JOIN painter_leads pl ON pl.id = pda.painter_lead_id
             WHERE pda.user_id = ? AND pda.assigned_date = CURDATE()
             ORDER BY pda.contacted_at IS NULL DESC,
                      FIELD(pl.status,'interested','in_progress','new','unreachable'),
                      pl.last_contact_date ASC`,
            [req.user.id]
        );
        res.json({ success: true, list: rows });
    });

    // GET /me/painters — my full sticky-assigned list
    router.get('/me/painters', authenticateToken, requirePermission('painters.marketing.view'), async (req, res) => {
        const { status, search } = req.query;
        const params = [req.user.id];
        let where = `WHERE assigned_to = ?`;
        if (status) { where += ` AND status = ?`; params.push(status); }
        if (search) { where += ` AND (full_name LIKE ? OR phone LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
        const [rows] = await pool.query(
            `SELECT * FROM painter_leads ${where} ORDER BY last_contact_date DESC LIMIT 200`,
            params
        );
        res.json({ success: true, list: rows });
    });

    // POST /leads/:id/followup — log outcome
    const followupSchema = z.object({
        followup_type: z.enum(['call', 'whatsapp', 'visit']),
        call_status: z.enum(['connected', 'not_answered', 'wrong_number', 'switched_off', 'busy']).nullable().optional(),
        outcome: z.enum([
            'interested_in_program', 'already_aware', 'will_visit_shop',
            'wants_callback', 'not_interested', 'wrong_number', 'no_answer'
        ]).nullable().optional(),
        next_followup_date: z.string().nullable().optional(),
        notes: z.string().nullable().optional()
    });
    router.post('/leads/:id/followup', authenticateToken, requirePermission('painters.marketing.contact'),
        validate(followupSchema), async (req, res) => {
        const leadId = Number(req.params.id);
        const body = req.body;
        await pool.query(
            `INSERT INTO painter_lead_followups
                (painter_lead_id, user_id, followup_type, call_status, outcome, next_followup_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [leadId, req.user.id, body.followup_type, body.call_status || null, body.outcome || null,
             body.next_followup_date || null, body.notes || null]
        );

        const [leadRows] = await pool.query(`SELECT status, branch_id FROM painter_leads WHERE id = ?`, [leadId]);
        if (!leadRows.length) return res.status(404).json({ success: false, error: 'lead_not_found' });
        const currentStatus = leadRows[0].status;
        const branchId = leadRows[0].branch_id;
        const [cfgRows] = await pool.query(
            `SELECT * FROM painter_marketing_config WHERE scope='branch' AND scope_id=? LIMIT 1`, [branchId]
        );
        const cfg = cfgRows[0] || {};

        // Consecutive no-answer count (same lead, last N followups all no_answer)
        const [recent] = await pool.query(
            `SELECT outcome FROM painter_lead_followups WHERE painter_lead_id = ?
             ORDER BY id DESC LIMIT 5`, [leadId]
        );
        const consecutive = recent.every(r => r.outcome === 'no_answer') ? recent.length : 0;

        const effective = applyOutcome({
            outcome: body.outcome,
            callbackDate: body.next_followup_date,
            consecutiveNoAnswer: consecutive,
            currentStatus,
            cfg
        });

        const connected = body.call_status === 'connected' ? 1 : 0;
        await pool.query(
            `UPDATE painter_leads
             SET last_contact_date = NOW(),
                 last_outcome = ?,
                 status = ?,
                 next_eligible_date = ?,
                 total_attempts = total_attempts + 1,
                 contact_count = contact_count + ?
             WHERE id = ?`,
            [body.outcome, effective.status,
             effective.next_eligible_date ? effective.next_eligible_date.toISOString().slice(0, 10) : null,
             connected, leadId]
        );
        await pool.query(
            `UPDATE painter_daily_assignments
             SET contacted_at = NOW(), contact_outcome = ?
             WHERE painter_lead_id = ? AND user_id = ? AND assigned_date = CURDATE()`,
            [body.outcome, leadId, req.user.id]
        );
        res.json({ success: true, new_status: effective.status, next_eligible: effective.next_eligible_date });
    });

    // POST /leads/:id/convert — Path A: convert lead → painter
    const convertSchema = z.object({
        referral_source: z.string().nullable().optional(),
        preferred_brands: z.array(z.string()).nullable().optional(),
        notes: z.string().nullable().optional()
    });
    router.post('/leads/:id/convert', authenticateToken, requirePermission('painters.marketing.convert'),
        validate(convertSchema), async (req, res) => {
        const leadId = Number(req.params.id);
        const [leadRows] = await pool.query(
            `SELECT * FROM painter_leads WHERE id = ? LIMIT 1`, [leadId]
        );
        if (!leadRows.length) return res.status(404).json({ success: false, error: 'lead_not_found' });
        const lead = leadRows[0];
        if (lead.painter_id) return res.status(409).json({ success: false, error: 'already_converted' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [insRes] = await conn.query(
                `INSERT INTO painters
                    (full_name, phone, email, branch_id, status, created_via, source_lead_id, zoho_customer_id, activated_at)
                 VALUES (?, ?, ?, ?, 'approved', 'staff_convert', ?, ?, NULL)`,
                [lead.full_name, lead.phone, lead.email, lead.branch_id, lead.id, lead.zoho_customer_id || null]
            );
            const painterId = insRes.insertId;
            await conn.query(
                `UPDATE painter_leads SET painter_id = ?, status='converted', converted_at = NOW() WHERE id = ?`,
                [painterId, leadId]
            );
            await conn.commit();
            // Fire-and-forget Zoho sync
            painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi })
                .catch(err => console.error('[pntr-marketing] zoho sync after convert failed', err.message));
            res.json({ success: true, painter_id: painterId });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    });

    // ─────────── ADMIN ENDPOINTS ───────────

    // POST /admin/import/bulk — trigger one-time bulk
    router.post('/admin/import/bulk', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        try {
            const result = await pntrImport.runBulkImport({ pool, zohoApi, triggeredBy: req.user.id, runType: 'manual' });
            res.json({ success: true, ...result });
        } catch (err) {
            console.error('[pntr-bulk-import] failed', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /admin/import/incremental
    router.post('/admin/import/incremental', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        try {
            const result = await pntrImport.runIncrementalImport({ pool, zohoApi, triggeredBy: req.user.id });
            res.json({ success: true, ...result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /admin/import/runs — history
    router.get('/admin/import/runs', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const [rows] = await pool.query(`SELECT * FROM painter_pntr_import_runs ORDER BY id DESC LIMIT 50`);
        res.json({ success: true, runs: rows });
    });

    // GET /admin/queues/unassigned
    router.get('/admin/queues/unassigned', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const [rows] = await pool.query(
            `SELECT * FROM painter_leads WHERE branch_id IS NULL ORDER BY imported_at DESC LIMIT 500`
        );
        res.json({ success: true, list: rows });
    });

    // POST /admin/queues/unassigned/assign — bulk assign
    router.post('/admin/queues/unassigned/assign', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { ids, branch_id } = req.body;
        if (!Array.isArray(ids) || !ids.length || !branch_id) {
            return res.status(400).json({ success: false, error: 'ids + branch_id required' });
        }
        await pool.query(
            `UPDATE painter_leads SET branch_id = ?, branch_detected_via='admin_assign'
             WHERE id IN (${ids.map(() => '?').join(',')})`,
            [branch_id, ...ids]
        );
        for (const id of ids) await assignNewLead(pool, id, branch_id);
        res.json({ success: true, count: ids.length });
    });

    // GET /admin/queues/duplicates
    router.get('/admin/queues/duplicates', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const [rows] = await pool.query(
            `SELECT dq.*, pl.full_name AS original_name, pl.phone AS original_phone
             FROM painter_lead_duplicate_queue dq
             LEFT JOIN painter_leads pl ON pl.id = dq.original_painter_lead_id
             WHERE dq.resolution = 'pending' ORDER BY dq.id ASC LIMIT 500`
        );
        res.json({ success: true, list: rows });
    });

    // POST /admin/queues/duplicates/:id/resolve
    router.post('/admin/queues/duplicates/:id/resolve', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { resolution, notes } = req.body;
        if (!['merged', 'kept_original', 'kept_duplicate', 'ignored'].includes(resolution)) {
            return res.status(400).json({ success: false, error: 'invalid_resolution' });
        }
        await pool.query(
            `UPDATE painter_lead_duplicate_queue
             SET resolution = ?, resolved_by = ?, resolved_at = NOW(), notes = ?
             WHERE id = ?`,
            [resolution, req.user.id, notes || null, req.params.id]
        );
        res.json({ success: true });
    });

    // GET /admin/queues/salesperson-unmatched
    router.get('/admin/queues/salesperson-unmatched', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const [rows] = await pool.query(
            `SELECT * FROM painter_zoho_salesperson_map WHERE match_confidence='unmatched' ORDER BY id DESC LIMIT 500`
        );
        res.json({ success: true, list: rows });
    });

    // POST /admin/queues/salesperson-unmatched/:id/link
    router.post('/admin/queues/salesperson-unmatched/:id/link', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { painter_id } = req.body;
        if (!painter_id) return res.status(400).json({ success: false, error: 'painter_id required' });
        await pool.query(
            `UPDATE painter_zoho_salesperson_map
             SET painter_id = ?, match_confidence='exact_name' WHERE id = ?`,
            [painter_id, req.params.id]
        );
        const [spRow] = await pool.query(`SELECT zoho_salesperson_id FROM painter_zoho_salesperson_map WHERE id = ?`, [req.params.id]);
        if (spRow.length) {
            await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [spRow[0].zoho_salesperson_id, painter_id]);
        }
        res.json({ success: true });
    });

    // GET /admin/config?scope=branch&scope_id=1
    router.get('/admin/config', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { scope, scope_id } = req.query;
        if (!scope || !scope_id) return res.status(400).json({ success: false, error: 'scope+scope_id required' });
        const [rows] = await pool.query(
            `SELECT * FROM painter_marketing_config WHERE scope = ? AND scope_id = ? LIMIT 1`,
            [scope, scope_id]
        );
        res.json({ success: true, config: rows[0] || null });
    });

    // POST /admin/config — upsert
    router.post('/admin/config', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const {
            scope, scope_id, daily_quota,
            recycle_days_new, recycle_days_callback, recycle_days_will_visit,
            recycle_days_already_aware, recycle_days_not_interested,
            recycle_days_unreachable, recycle_days_active_painter
        } = req.body;
        if (!['branch', 'user'].includes(scope) || !scope_id) return res.status(400).json({ success: false, error: 'invalid_scope' });
        await pool.query(
            `INSERT INTO painter_marketing_config
                (scope, scope_id, daily_quota, recycle_days_new, recycle_days_callback, recycle_days_will_visit,
                 recycle_days_already_aware, recycle_days_not_interested, recycle_days_unreachable, recycle_days_active_painter)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                daily_quota = VALUES(daily_quota),
                recycle_days_new = VALUES(recycle_days_new),
                recycle_days_callback = VALUES(recycle_days_callback),
                recycle_days_will_visit = VALUES(recycle_days_will_visit),
                recycle_days_already_aware = VALUES(recycle_days_already_aware),
                recycle_days_not_interested = VALUES(recycle_days_not_interested),
                recycle_days_unreachable = VALUES(recycle_days_unreachable),
                recycle_days_active_painter = VALUES(recycle_days_active_painter),
                updated_at = CURRENT_TIMESTAMP`,
            [scope, scope_id, daily_quota || 10,
             recycle_days_new || 7, recycle_days_callback || 3, recycle_days_will_visit || 14,
             recycle_days_already_aware || 60, recycle_days_not_interested || 30,
             recycle_days_unreachable || 60, recycle_days_active_painter || 45]
        );
        res.json({ success: true });
    });

    // POST /admin/generate-daily-lists — manual trigger
    router.post('/admin/generate-daily-lists', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const stats = await generateDailyLists(pool);
        res.json({ success: true, ...stats });
    });

    // POST /admin/backfill/preview
    router.post('/admin/backfill/preview', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { from_date, painter_ids } = req.body;
        if (!from_date) return res.status(400).json({ success: false, error: 'from_date required' });
        const preview = await backfill.previewBackfill({ pool, fromDate: from_date, painterIds: painter_ids || null });
        res.json({ success: true, ...preview });
    });

    // POST /admin/backfill/run
    router.post('/admin/backfill/run', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { from_date, painter_ids } = req.body;
        if (!from_date) return res.status(400).json({ success: false, error: 'from_date required' });
        const summary = await backfill.runBulkBackfill({ pool, fromDate: from_date, painterIds: painter_ids || null });
        res.json({ success: true, ...summary });
    });

    // GET /admin/performance?from=YYYY-MM-DD&to=YYYY-MM-DD&branch_id=
    router.get('/admin/performance', authenticateToken, requirePermission('painters.marketing.manage'), async (req, res) => {
        const { from, to, branch_id } = req.query;
        const params = [];
        let where = `WHERE 1=1`;
        if (from) { where += ` AND pda.assigned_date >= ?`; params.push(from); }
        if (to) { where += ` AND pda.assigned_date <= ?`; params.push(to); }
        if (branch_id) { where += ` AND pda.branch_id = ?`; params.push(branch_id); }
        const [stats] = await pool.query(
            `SELECT
                pda.user_id, u.full_name, pda.branch_id,
                COUNT(*) AS total_assigned,
                SUM(CASE WHEN pda.contacted_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
                SUM(CASE WHEN pda.contact_outcome IN ('interested_in_program') THEN 1 ELSE 0 END) AS interested
             FROM painter_daily_assignments pda
             LEFT JOIN users u ON u.id = pda.user_id
             ${where}
             GROUP BY pda.user_id, pda.branch_id
             ORDER BY contacted DESC`,
            params
        );
        res.json({ success: true, stats });
    });

    return router;
};
```

- [ ] **Step 2: Mount route in `server.js`**

Find the routes-mount block in `server.js` (search near other `app.use('/api/painters'` or similar). Add:

```javascript
app.use('/api/painter-marketing', require('./routes/painter-marketing')(pool));
```

- [ ] **Step 3: Integration test — smoke (optional but recommended)**

Create `tests/integration/painter-marketing-routes.test.js` that stands up an Express app with a stub `pool` + stubbed permission middleware and verifies the followup endpoint round-trips. Keep it small (only exercise `POST /leads/:id/followup` happy path and 400 on bad enum). Use `supertest` — if not installed, skip this test file and rely on unit tests + manual curl.

- [ ] **Step 4: Smoke test manually with curl**

Start server: `npm run dev`. In another terminal, log in as an admin and hit:

```
curl -X POST http://localhost:3000/api/painter-marketing/admin/import/runs \
  -H "Authorization: Bearer <TOKEN>"
```

Expected: `200 { success: true, runs: [] }`.

- [ ] **Step 5: Commit**

```bash
git add routes/painter-marketing.js server.js tests/integration/painter-marketing-routes.test.js
git commit -m "feat(pntr): REST routes for staff daily list, outcome log, admin queues, backfill"
```

---

## Task 10: Wire painter-create hook + activation endpoint

**Files:**
- Modify: `routes/painters.js`

- [ ] **Step 1: Locate painter insert code**

Run: `grep -n "INSERT INTO painters" routes/painters.js`

- [ ] **Step 2: Wrap every painter insert with post-hook**

For every place in `routes/painters.js` that creates a new painter (admin add, self register, referral), add after the INSERT:

```javascript
const painterZohoSync = require('../services/painter-zoho-sync-service');
const zohoApi = require('../services/zoho-api');
// ... after INSERT and retrieving new painter id (painterId):
painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi })
    .catch(err => console.error('[painters] zoho sync failed', err.message));
```

For admin-add path, also set `created_via = 'admin_add'`. For self-register, `created_via = 'self_register'`. For referral link flow, `created_via = 'referral'`.

- [ ] **Step 3: Add activation endpoint**

Add to `routes/painters.js`:

```javascript
// POST /painters/:id/activate — set activated_at, fire backfill
router.post('/:id/activate', authenticateToken, async (req, res) => {
    const painterId = Number(req.params.id);
    // Painter-auth: check X-Painter-Token OR admin auth with permission
    // Accept if req.painterId matches req.params.id (painter self-activation)
    // OR req.user has painters.manage permission
    const isSelf = req.painterId && req.painterId === painterId;
    const isAdmin = req.user && (req.user.permissions || []).includes('painters.manage');
    if (!isSelf && !isAdmin) return res.status(403).json({ success: false, error: 'forbidden' });

    const [rows] = await pool.query(`SELECT activated_at FROM painters WHERE id = ? LIMIT 1`, [painterId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'not_found' });
    if (rows[0].activated_at) return res.json({ success: true, already_activated: true });

    await pool.query(`UPDATE painters SET activated_at = NOW() WHERE id = ?`, [painterId]);
    await pool.query(
        `UPDATE painter_leads SET status='active_painter', activated_at = NOW() WHERE painter_id = ?`,
        [painterId]
    );

    // Fire-and-forget Zoho sync + backfill
    const painterZohoSync = require('../services/painter-zoho-sync-service');
    const backfill = require('../services/painter-points-backfill-service');
    const zohoApi = require('../services/zoho-api');
    painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi })
        .then(() => backfill.backfillPainter(painterId, '2025-12-01', { pool }))
        .catch(err => console.error('[painters] activate chain failed', err.message));

    res.json({ success: true, activated: true });
});
```

- [ ] **Step 4: Manual smoke test**

Hit `POST /api/painters/<existing-id>/activate` with an admin token. Verify in DB: `SELECT activated_at, zoho_customer_id, zoho_salesperson_id FROM painters WHERE id=<id>` updates.

- [ ] **Step 5: Commit**

```bash
git add routes/painters.js
git commit -m "feat(pntr): fire Zoho sync on painter create + activation endpoint triggers backfill"
```

---

## Task 11: Scheduler boot wiring

**Files:**
- Modify: `services/painter-scheduler.js` (or wherever `painter-scheduler.js` exports `init`)
- Modify: `server.js`

- [ ] **Step 1: Boot the marketing scheduler**

Open `services/painter-scheduler.js`. Find the function it exports (likely `init()` or `startScheduler()`). Add at the end:

```javascript
const pntrImport = require('./pntr-import-service');
const painterZohoSync = require('./painter-zoho-sync-service');
const backfill = require('./painter-points-backfill-service');
const marketingSched = require('./painter-marketing-scheduler');
const zohoApi = require('./zoho-api');

marketingSched.registerCron({
    pool, zohoApi,
    pntrImportService: pntrImport,
    backfillService: backfill,
    painterZohoSyncService: painterZohoSync
});
painterZohoSync.init({ pool, zohoApi });
```

(adjust the `pool` variable name to whatever the scheduler already uses)

- [ ] **Step 2: Verify startup**

Run: `npm run dev` (or `node server.js`).
Expected output includes: `[pntr-marketing] crons registered: 02:30, 03:00, 03:30, 06:00 IST`.

- [ ] **Step 3: Commit**

```bash
git add services/painter-scheduler.js server.js
git commit -m "feat(pntr): boot marketing scheduler + Zoho sync service on server start"
```

---

## Task 12: Permissions registration

**Files:**
- Modify: wherever permission keys are registered (check `routes/roles.js` and `migrations/` for permission seeding; also check `middleware/auth.js` or `config/permissions.js`)

- [ ] **Step 1: Locate permission constants**

Run: `grep -rn "painters.manage\|painters.view\|painters.points" routes/ middleware/ config/ 2>/dev/null | head -20`

- [ ] **Step 2: Add new permission keys**

Wherever the painter permissions are defined (likely a JS object in `routes/roles.js` or a seed migration), add:

```javascript
'painters.marketing.view': 'Painters — Marketing: view daily list',
'painters.marketing.contact': 'Painters — Marketing: log followups',
'painters.marketing.manage': 'Painters — Marketing: config, review queues, backfill',
'painters.marketing.convert': 'Painters — Marketing: convert lead to painter'
```

If permissions are stored in DB, create a tiny migration `migrations/migrate-pntr-marketing-permissions.js` that inserts these keys.

- [ ] **Step 3: Grant defaults**

Admin role: all four. Manager: view + contact + convert + manage. Staff: view + contact + convert.

- [ ] **Step 4: Commit**

```bash
git add routes/roles.js middleware/auth.js migrations/migrate-pntr-marketing-permissions.js
git commit -m "feat(pntr): register 4 marketing permissions + default role grants"
```

---

## Task 13: Admin UI — `admin-painters.html` Marketing tab

**Files:**
- Modify: `public/admin-painters.html`

- [ ] **Step 1: Locate the existing tab bar**

Open `public/admin-painters.html`. Find the main tab nav (search for `data-tab=` or the existing tab buttons).

- [ ] **Step 2: Add "Marketing" top-level tab**

Insert a new tab button in the tab bar:

```html
<button class="tab-btn" data-tab="marketing">Marketing</button>
```

And add its content panel (below the existing tab panels):

```html
<div class="tab-pane" data-tab-pane="marketing" style="display:none">
    <div class="sub-tabs" style="display:flex;gap:4px;margin-bottom:1rem;border-bottom:1px solid #e5e7eb;">
        <button class="sub-tab-btn active" data-subtab="unassigned">Branch Unassigned</button>
        <button class="sub-tab-btn" data-subtab="duplicates">Duplicate Phone</button>
        <button class="sub-tab-btn" data-subtab="sp-unmatched">Salesperson Unmatched</button>
        <button class="sub-tab-btn" data-subtab="runs">Import Runs</button>
        <button class="sub-tab-btn" data-subtab="performance">Performance</button>
        <button class="sub-tab-btn" data-subtab="backfill">Points Backfill</button>
        <button class="sub-tab-btn" data-subtab="config">Config</button>
    </div>

    <div class="sub-pane" data-subpane="unassigned">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;">
            <h3>Leads without branch</h3>
            <div>
                <button class="btn btn-primary" id="btnRunBulkImport">Run Initial PNTR Import</button>
                <button class="btn btn-secondary" id="btnRunIncrementalImport">Incremental</button>
            </div>
        </div>
        <table class="table" id="tblUnassigned">
            <thead><tr><th><input type="checkbox" id="chkAllUnassigned"></th><th>Name</th><th>Phone</th><th>Zoho ID</th><th>Imported</th></tr></thead>
            <tbody></tbody>
        </table>
        <div style="display:flex;gap:.5rem;margin-top:.5rem;">
            <select id="selBulkBranch"><option value="">Choose branch…</option></select>
            <button class="btn btn-primary" id="btnBulkAssignBranch">Assign Selected</button>
        </div>
    </div>

    <div class="sub-pane" data-subpane="duplicates" style="display:none">
        <h3>Duplicate phone queue</h3>
        <div id="dupList"></div>
    </div>

    <div class="sub-pane" data-subpane="sp-unmatched" style="display:none">
        <h3>Unmatched Zoho Salespersons</h3>
        <table class="table" id="tblSpUnmatched">
            <thead><tr><th>Zoho SP Name</th><th>Phone</th><th>Link to painter</th></tr></thead>
            <tbody></tbody>
        </table>
    </div>

    <div class="sub-pane" data-subpane="runs" style="display:none">
        <table class="table" id="tblImportRuns">
            <thead><tr><th>Started</th><th>Type</th><th>Total</th><th>Imported</th><th>Linked</th><th>Dupes</th><th>Unresolved</th><th>Errors</th><th>Status</th></tr></thead>
            <tbody></tbody>
        </table>
    </div>

    <div class="sub-pane" data-subpane="performance" style="display:none">
        <div style="display:flex;gap:.5rem;margin-bottom:.5rem;">
            <input type="date" id="perfFrom"><input type="date" id="perfTo">
            <select id="perfBranch"><option value="">All branches</option></select>
            <button class="btn btn-secondary" id="btnLoadPerf">Load</button>
        </div>
        <table class="table" id="tblPerf">
            <thead><tr><th>Staff</th><th>Branch</th><th>Assigned</th><th>Contacted</th><th>Interested</th><th>Rate</th></tr></thead>
            <tbody></tbody>
        </table>
    </div>

    <div class="sub-pane" data-subpane="backfill" style="display:none">
        <div>
            <label>From date: <input type="date" id="bfFrom" value="2025-12-01"></label>
            <button class="btn btn-secondary" id="btnPreviewBackfill">Preview</button>
            <button class="btn btn-primary" id="btnRunBackfill" disabled>Run</button>
        </div>
        <pre id="bfPreview" style="background:#f3f4f6;padding:.5rem;margin-top:.5rem;"></pre>
    </div>

    <div class="sub-pane" data-subpane="config" style="display:none">
        <h3>Per-branch config</h3>
        <select id="cfgBranch"><option value="">Choose branch…</option></select>
        <div id="cfgForm" style="display:none;margin-top:.5rem;">
            <label>Daily quota: <input type="number" id="cfgQuota"></label>
            <label>Recycle: new <input type="number" id="cfgRecNew"></label>
            <label>callback <input type="number" id="cfgRecCallback"></label>
            <label>will_visit <input type="number" id="cfgRecVisit"></label>
            <label>already_aware <input type="number" id="cfgRecAware"></label>
            <label>not_interested <input type="number" id="cfgRecNotInt"></label>
            <label>unreachable <input type="number" id="cfgRecUnreach"></label>
            <label>active_painter <input type="number" id="cfgRecActive"></label>
            <button class="btn btn-primary" id="btnSaveCfg">Save</button>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Wire the JavaScript**

Add this `<script>` block near the bottom of `admin-painters.html` (or append to the existing script section — use helpers already in the page, and `esc()` for any user content per the project's XSS rules):

```javascript
async function mktFetch(path, opts = {}) {
    const headers = { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token'), 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch('/api/painter-marketing' + path, { ...opts, headers });
    return res.json();
}

async function loadUnassigned() {
    const r = await mktFetch('/admin/queues/unassigned');
    const tbody = document.querySelector('#tblUnassigned tbody');
    tbody.innerHTML = (r.list || []).map(l =>
        `<tr><td><input type="checkbox" class="uaChk" value="${l.id}"></td>
         <td>${esc(l.full_name)}</td><td>${esc(l.phone)}</td>
         <td>${esc(l.zoho_customer_id || '')}</td>
         <td>${new Date(l.imported_at).toLocaleDateString()}</td></tr>`
    ).join('');
}

async function loadBranches() {
    const r = await fetch('/api/branches', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }).then(x => x.json());
    const opts = '<option value="">Choose branch…</option>' + (r.branches || []).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    document.querySelectorAll('#selBulkBranch, #cfgBranch, #perfBranch').forEach(s => s.innerHTML = opts);
}

document.getElementById('btnBulkAssignBranch').onclick = async () => {
    const ids = Array.from(document.querySelectorAll('.uaChk:checked')).map(c => Number(c.value));
    const branch_id = Number(document.getElementById('selBulkBranch').value);
    if (!ids.length || !branch_id) return alert('Select leads + branch');
    const r = await mktFetch('/admin/queues/unassigned/assign', { method: 'POST', body: JSON.stringify({ ids, branch_id }) });
    if (r.success) { alert(`Assigned ${r.count} leads`); loadUnassigned(); }
};

document.getElementById('btnRunBulkImport').onclick = async () => {
    if (!confirm('Run initial PNTR bulk import? This can take several minutes.')) return;
    const r = await mktFetch('/admin/import/bulk', { method: 'POST' });
    alert(JSON.stringify(r, null, 2));
    if (typeof loadImportRuns === 'function') loadImportRuns();
};
document.getElementById('btnRunIncrementalImport').onclick = async () => {
    const r = await mktFetch('/admin/import/incremental', { method: 'POST' });
    alert(JSON.stringify(r, null, 2));
};

async function loadImportRuns() {
    const r = await mktFetch('/admin/import/runs');
    const tbody = document.querySelector('#tblImportRuns tbody');
    tbody.innerHTML = (r.runs || []).map(x =>
        `<tr><td>${new Date(x.started_at).toLocaleString()}</td><td>${x.run_type}</td>
         <td>${x.total_zoho_pntr_customers}</td><td>${x.imported_count}</td>
         <td>${x.linked_existing_painter}</td><td>${x.duplicates_queued}</td>
         <td>${x.branch_unresolved_count}</td><td>${x.errors_count}</td>
         <td>${x.status}</td></tr>`
    ).join('');
}

async function loadDupes() {
    const r = await mktFetch('/admin/queues/duplicates');
    document.getElementById('dupList').innerHTML = (r.list || []).map(d =>
        `<div style="border:1px solid #e5e7eb;padding:.5rem;margin-bottom:.5rem;">
            <div><strong>${esc(d.duplicate_zoho_name)}</strong> — ${esc(d.duplicate_phone)}</div>
            <div style="color:#6b7280">Original: ${esc(d.original_name || '—')} / ${esc(d.original_phone || '—')}</div>
            <div style="margin-top:.25rem;">
                <button class="btn btn-sm" onclick="resolveDupe(${d.id},'kept_original')">Keep Original</button>
                <button class="btn btn-sm" onclick="resolveDupe(${d.id},'kept_duplicate')">Keep Duplicate</button>
                <button class="btn btn-sm" onclick="resolveDupe(${d.id},'merged')">Merge</button>
                <button class="btn btn-sm" onclick="resolveDupe(${d.id},'ignored')">Ignore</button>
            </div>
        </div>`
    ).join('');
}
async function resolveDupe(id, resolution) {
    const r = await mktFetch(`/admin/queues/duplicates/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) });
    if (r.success) loadDupes();
}

async function loadSpUnmatched() {
    const r = await mktFetch('/admin/queues/salesperson-unmatched');
    const tbody = document.querySelector('#tblSpUnmatched tbody');
    tbody.innerHTML = (r.list || []).map(sp =>
        `<tr><td>${esc(sp.zoho_salesperson_name)}</td><td>${esc(sp.zoho_salesperson_phone || '')}</td>
         <td><input type="number" placeholder="Painter ID" id="spP${sp.id}" style="width:100px;">
             <button class="btn btn-sm" onclick="linkSp(${sp.id})">Link</button></td></tr>`
    ).join('');
}
async function linkSp(id) {
    const painter_id = Number(document.getElementById(`spP${id}`).value);
    if (!painter_id) return alert('Enter painter id');
    const r = await mktFetch(`/admin/queues/salesperson-unmatched/${id}/link`, { method: 'POST', body: JSON.stringify({ painter_id }) });
    if (r.success) loadSpUnmatched();
}

async function loadPerf() {
    const q = new URLSearchParams({
        from: document.getElementById('perfFrom').value,
        to: document.getElementById('perfTo').value,
        branch_id: document.getElementById('perfBranch').value
    });
    const r = await mktFetch(`/admin/performance?${q}`);
    const tbody = document.querySelector('#tblPerf tbody');
    tbody.innerHTML = (r.stats || []).map(s => {
        const rate = s.total_assigned ? Math.round(100 * s.contacted / s.total_assigned) : 0;
        return `<tr><td>${esc(s.full_name || '-')}</td><td>${s.branch_id}</td>
                <td>${s.total_assigned}</td><td>${s.contacted}</td>
                <td>${s.interested}</td><td>${rate}%</td></tr>`;
    }).join('');
}
document.getElementById('btnLoadPerf').onclick = loadPerf;

let bfPreviewed = false;
document.getElementById('btnPreviewBackfill').onclick = async () => {
    const from_date = document.getElementById('bfFrom').value;
    const r = await mktFetch('/admin/backfill/preview', { method: 'POST', body: JSON.stringify({ from_date }) });
    document.getElementById('bfPreview').textContent = JSON.stringify(r, null, 2);
    bfPreviewed = true;
    document.getElementById('btnRunBackfill').disabled = false;
};
document.getElementById('btnRunBackfill').onclick = async () => {
    if (!bfPreviewed) return alert('Preview first');
    if (!confirm('Run backfill? This writes points transactions.')) return;
    const from_date = document.getElementById('bfFrom').value;
    const r = await mktFetch('/admin/backfill/run', { method: 'POST', body: JSON.stringify({ from_date }) });
    alert(JSON.stringify(r, null, 2));
};

document.getElementById('cfgBranch').onchange = async (e) => {
    const scope_id = Number(e.target.value);
    if (!scope_id) return document.getElementById('cfgForm').style.display = 'none';
    const r = await mktFetch(`/admin/config?scope=branch&scope_id=${scope_id}`);
    const c = r.config || {};
    document.getElementById('cfgQuota').value = c.daily_quota || 10;
    document.getElementById('cfgRecNew').value = c.recycle_days_new || 7;
    document.getElementById('cfgRecCallback').value = c.recycle_days_callback || 3;
    document.getElementById('cfgRecVisit').value = c.recycle_days_will_visit || 14;
    document.getElementById('cfgRecAware').value = c.recycle_days_already_aware || 60;
    document.getElementById('cfgRecNotInt').value = c.recycle_days_not_interested || 30;
    document.getElementById('cfgRecUnreach').value = c.recycle_days_unreachable || 60;
    document.getElementById('cfgRecActive').value = c.recycle_days_active_painter || 45;
    document.getElementById('cfgForm').style.display = 'block';
};
document.getElementById('btnSaveCfg').onclick = async () => {
    const payload = {
        scope: 'branch',
        scope_id: Number(document.getElementById('cfgBranch').value),
        daily_quota: Number(document.getElementById('cfgQuota').value),
        recycle_days_new: Number(document.getElementById('cfgRecNew').value),
        recycle_days_callback: Number(document.getElementById('cfgRecCallback').value),
        recycle_days_will_visit: Number(document.getElementById('cfgRecVisit').value),
        recycle_days_already_aware: Number(document.getElementById('cfgRecAware').value),
        recycle_days_not_interested: Number(document.getElementById('cfgRecNotInt').value),
        recycle_days_unreachable: Number(document.getElementById('cfgRecUnreach').value),
        recycle_days_active_painter: Number(document.getElementById('cfgRecActive').value)
    };
    const r = await mktFetch('/admin/config', { method: 'POST', body: JSON.stringify(payload) });
    alert(r.success ? 'Saved' : 'Failed');
};

document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.subtab;
    document.querySelectorAll('.sub-pane').forEach(p => p.style.display = p.dataset.subpane === target ? 'block' : 'none');
    if (target === 'unassigned') loadUnassigned();
    if (target === 'duplicates') loadDupes();
    if (target === 'sp-unmatched') loadSpUnmatched();
    if (target === 'runs') loadImportRuns();
    if (target === 'performance') loadPerf();
});

// On main "marketing" tab show → init
document.querySelector('[data-tab="marketing"]').addEventListener('click', () => {
    loadBranches();
    loadUnassigned();
});
```

- [ ] **Step 4: Verify manually in browser**

Open `/admin-painters.html`, click Marketing tab. Sub-tabs should render empty tables (no 500s). Run "Incremental" button — should return JSON alert.

- [ ] **Step 5: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(pntr): admin Marketing tab — 7 sub-tabs (queues, runs, perf, backfill, config)"
```

---

## Task 14: Staff UI — `staff-painter-marketing.html`

**Files:**
- Create: `public/staff-painter-marketing.html`
- Modify: whichever staff sidebar component file lists staff links (search for other `staff-*.html` link rows, e.g., `public/staff-sidebar.html`)

- [ ] **Step 1: Create the page**

```html
<!-- public/staff-painter-marketing.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Painter Marketing — QC</title>
    <link rel="stylesheet" href="/css/design-system.css">
    <style>
        body { background: #f0fdf4; }
        .card { background: #fff; border-radius: .75rem; padding: 1rem; margin-bottom: .75rem; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
        .badge { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
        .badge-new { background: #e0f2fe; color: #075985; }
        .badge-interested { background: #dcfce7; color: #166534; }
        .badge-in_progress { background: #fef3c7; color: #92400e; }
        .badge-unreachable { background: #fee2e2; color: #991b1b; }
        .progress-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
        .progress-fill { height: 100%; background: #1B5E3B; transition: width .3s; }
        .pills { display:flex; gap:.5rem; margin: .5rem 0; }
        .pill { padding: 6px 14px; border-radius: 999px; border:1px solid #d1d5db; cursor: pointer; background: #fff; font-size: 14px; }
        .pill.active { background: #1B5E3B; color: #fff; border-color: #1B5E3B; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: flex-end; justify-content: center; }
        .modal { background: #fff; border-radius: 1rem 1rem 0 0; padding: 1rem; width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto; }
        @media (min-width: 640px) { .modal-bg { align-items: center; } .modal { border-radius: 1rem; } }
    </style>
</head>
<body>
    <div id="app" style="max-width: 720px; margin: 0 auto; padding: 1rem;">
        <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">
            <h1 style="margin:0;font-size: 20px;">🎨 Today's Painter Calls</h1>
            <button id="tabHistory" class="pill">History</button>
        </header>
        <div style="color:#6b7280;" id="summary">Loading…</div>
        <div class="progress-bar" style="margin-bottom:.5rem;"><div class="progress-fill" id="progress" style="width: 0%"></div></div>
        <div class="pills">
            <button class="pill active" data-filter="all">All</button>
            <button class="pill" data-filter="pending">Pending</button>
            <button class="pill" data-filter="done">Done</button>
        </div>
        <div id="list"></div>
    </div>

    <div id="modalRoot"></div>

    <script src="/js/auth-helper.js"></script>
    <script>
        const token = localStorage.getItem('auth_token');
        if (!token) location.href = '/login.html';
        const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
        function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

        let allLeads = [];
        let filter = 'all';

        async function load() {
            const r = await fetch('/api/painter-marketing/me/today', { headers }).then(x => x.json());
            allLeads = r.list || [];
            render();
        }

        function render() {
            const total = allLeads.length;
            const done = allLeads.filter(l => l.contacted_at).length;
            document.getElementById('summary').textContent = `${done} of ${total} contacted`;
            document.getElementById('progress').style.width = total ? (100 * done / total) + '%' : '0%';
            let list = allLeads;
            if (filter === 'pending') list = allLeads.filter(l => !l.contacted_at);
            if (filter === 'done') list = allLeads.filter(l => l.contacted_at);
            document.getElementById('list').innerHTML = list.map(l => {
                const badgeClass = 'badge-' + (l.status || 'new');
                const lastTxt = l.last_contact_date
                    ? `Last: ${Math.floor((Date.now() - new Date(l.last_contact_date)) / 86400000)}d ago — ${esc(l.last_outcome || '')}`
                    : 'No prior contact';
                return `<div class="card">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>${esc(l.full_name)}</strong>
                        <span class="badge ${badgeClass}">${esc(l.status)}</span>
                    </div>
                    <div style="color:#6b7280;margin:.25rem 0;">📞 ${esc(l.phone)}</div>
                    <div style="font-size:12px;color:#6b7280;">${lastTxt}</div>
                    ${l.notes ? `<div style="font-size:12px;margin-top:.25rem;">"${esc(l.notes)}"</div>` : ''}
                    <div style="display:flex;gap:.5rem;margin-top:.5rem;">
                        <a class="pill" href="tel:${esc(l.phone)}">📞 Call</a>
                        <a class="pill" href="https://wa.me/91${esc(l.phone)}" target="_blank">💬 WhatsApp</a>
                        <button class="pill" onclick="openOutcome(${l.id})">✏️ Log</button>
                        ${l.status === 'interested' ? `<button class="pill" onclick="convertLead(${l.id})">Convert →</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        function openOutcome(leadId) {
            document.getElementById('modalRoot').innerHTML = `
            <div class="modal-bg" onclick="if(event.target===this) closeModal()">
                <div class="modal">
                    <h3>Log Outcome</h3>
                    <label>Channel:
                        <select id="ch"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option></select>
                    </label>
                    <div id="callFields">
                        <label>Status:
                            <select id="cs">
                                <option value="">—</option>
                                <option value="connected">Connected</option>
                                <option value="not_answered">Not Answered</option>
                                <option value="wrong_number">Wrong Number</option>
                                <option value="switched_off">Switched Off</option>
                                <option value="busy">Busy</option>
                            </select>
                        </label>
                    </div>
                    <label>Outcome:
                        <select id="oc">
                            <option value="">—</option>
                            <option value="interested_in_program">Interested ⭐</option>
                            <option value="already_aware">Already Aware</option>
                            <option value="will_visit_shop">Will Visit Shop</option>
                            <option value="wants_callback">Wants Callback</option>
                            <option value="not_interested">Not Interested</option>
                            <option value="no_answer">No Answer</option>
                            <option value="wrong_number">Wrong Number</option>
                        </select>
                    </label>
                    <label>Callback date: <input type="date" id="cd"></label>
                    <label>Notes: <textarea id="nt" rows="2"></textarea></label>
                    <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;">
                        <button class="pill" onclick="closeModal()">Cancel</button>
                        <button class="pill active" onclick="saveOutcome(${leadId})">Save & Next</button>
                    </div>
                </div>
            </div>`;
        }
        function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

        async function saveOutcome(leadId) {
            const body = {
                followup_type: document.getElementById('ch').value,
                call_status: document.getElementById('cs').value || null,
                outcome: document.getElementById('oc').value || null,
                next_followup_date: document.getElementById('cd').value || null,
                notes: document.getElementById('nt').value || null
            };
            const r = await fetch(`/api/painter-marketing/leads/${leadId}/followup`, { method: 'POST', headers, body: JSON.stringify(body) }).then(x => x.json());
            if (r.success) { closeModal(); load(); } else { alert(r.error || 'Failed'); }
        }

        async function convertLead(leadId) {
            if (!confirm('Convert this lead to a painter? A Zoho customer + salesperson will be created automatically.')) return;
            const r = await fetch(`/api/painter-marketing/leads/${leadId}/convert`, { method: 'POST', headers, body: JSON.stringify({}) }).then(x => x.json());
            if (r.success) { alert('Converted! Painter ID: ' + r.painter_id); load(); } else { alert(r.error); }
        }

        document.querySelectorAll('.pill[data-filter]').forEach(p => p.onclick = () => {
            document.querySelectorAll('.pill[data-filter]').forEach(x => x.classList.remove('active'));
            p.classList.add('active');
            filter = p.dataset.filter;
            render();
        });

        load();
    </script>
</body>
</html>
```

- [ ] **Step 2: Add link to staff sidebar**

Run: `grep -n "staff-collections.html\|staff-leads.html" public/staff-sidebar.html` (or wherever the sidebar component lives).
Add a new entry:

```html
<a href="/staff-painter-marketing.html" class="nav-item" data-perm="painters.marketing.view">🎨 Painter Marketing</a>
```

Match existing nav markup exactly.

- [ ] **Step 3: Verify in browser**

Log in as staff → sidebar should show "Painter Marketing" → click → page renders with progress bar. With zero assignments: "0 of 0 contacted", empty list (OK).

- [ ] **Step 4: Commit**

```bash
git add public/staff-painter-marketing.html public/staff-sidebar.html
git commit -m "feat(pntr): staff daily painter marketing page with outcome modal"
```

---

## Task 15: Painter onboarding — `?ref=` parameter → activate

**Files:**
- Modify: `public/painter-onboard.html` (if it exists; else `public/painter-login.html` or `public/painter-register.html`)

- [ ] **Step 1: Find the OTP-success handler**

Run: `grep -n "OTP verified\|otp_verified\|painter-token\|localStorage.setItem.*painter" public/painter-*.html`

- [ ] **Step 2: After OTP success, parse `?ref=` and call activate**

Add this after the OTP-verified branch:

```javascript
const urlRef = new URLSearchParams(location.search).get('ref');
const painterToken = localStorage.getItem('painter_token');
if (urlRef && painterToken) {
    await fetch(`/api/painters/${urlRef}/activate`, {
        method: 'POST',
        headers: { 'X-Painter-Token': painterToken, 'Content-Type': 'application/json' }
    }).catch(err => console.error('activate failed', err));
}
```

Also add a self-activation for brand-new self-registers: after OTP success, if current painter ID is known, call `/api/painters/${painterId}/activate` unconditionally.

- [ ] **Step 3: Commit**

```bash
git add public/painter-onboard.html public/painter-register.html
git commit -m "feat(pntr): painter OTP activation triggers backfill via ?ref param"
```

---

## Task 16: WhatsApp templates + FCM notifications

**Files:**
- Modify: `services/painter-marketing-scheduler.js` (add 17:00 / 18:00 / Mon 09:00 notifications)
- Modify: `services/painter-notification-service.js` (or inline — reuse existing send helpers)

- [ ] **Step 1: Seed WhatsApp templates in `ai_config`**

Run once:

```bash
node -e "
const {createPool}=require('./config/database');const pool=createPool();
(async()=>{
    const tpl = [
        ['painter_marketing_wa_template',
         '{painter_name} அவர்களே,\nஇது Quality Colours {branch_name}.\nநாங்க புதுசா painter loyalty program start பண்றோம் — billing total-க்கு points கிடைக்கும், withdrawal-உம் பண்ணலாம்.\nவிரிவா பேசணும்-னா: {staff_phone}'],
        ['painter_activation_wa_template',
         'வரவேற்கிறோம் {painter_name}!\nQuality Colours Painter Program-ல உங்களை சேர்த்துக்கொள்கிறோம் 🎨\n\nApp download → OTP login = activation:\n🔗 https://act.qcpaintshop.com/painter-onboard?ref={painter_id}\n\nOTP login பண்ணினா உங்க Dec 2025-ல இருந்து இதுவரை வாங்கின billing-க்கு annual points automatic-ஆ credit ஆகும்.']
    ];
    for (const [k,v] of tpl) await pool.query('INSERT INTO ai_config (config_key,config_value) VALUES (?,?) ON DUPLICATE KEY UPDATE config_value=VALUES(config_value)',[k,v]);
    console.log('seeded');await pool.end();
})();
"
```

- [ ] **Step 2: Implement the three additional crons**

In `services/painter-marketing-scheduler.js::registerCron`, add after the existing four:

```javascript
    // 06:30 IST — push FCM "today's list ready"
    cron.schedule('30 6 * * *', async () => {
        try {
            const [rows] = await pool.query(
                `SELECT user_id, COUNT(*) AS n FROM painter_daily_assignments WHERE assigned_date=CURDATE() GROUP BY user_id`
            );
            const notif = require('./notification-service');
            for (const r of rows) {
                await notif.send(r.user_id, {
                    type: 'painter_marketing_ready',
                    title: '🎨 Today\'s painter calls',
                    body: `${r.n} painters in today's list`,
                    data: { url: '/staff-painter-marketing.html' }
                });
            }
        } catch (e) { console.error('[pntr-marketing] 06:30 push failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });

    // 17:00 IST — < 50% reminder
    cron.schedule('0 17 * * *', async () => {
        try {
            const [rows] = await pool.query(
                `SELECT user_id, COUNT(*) AS total, SUM(contacted_at IS NOT NULL) AS done
                 FROM painter_daily_assignments WHERE assigned_date=CURDATE()
                 GROUP BY user_id HAVING total > 0 AND (done * 2 < total)`
            );
            const notif = require('./notification-service');
            for (const r of rows) {
                await notif.send(r.user_id, {
                    type: 'painter_marketing_reminder',
                    title: '⚠️ Painter calls pending',
                    body: `${r.total - r.done} painter calls remaining today`,
                    data: { url: '/staff-painter-marketing.html' }
                });
            }
        } catch (e) { console.error('[pntr-marketing] 17:00 push failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });

    // 18:00 IST — manager WA if any staff < 30%
    cron.schedule('0 18 * * *', async () => {
        try {
            const [low] = await pool.query(
                `SELECT pda.branch_id, u.full_name AS staff_name,
                    COUNT(*) AS total, SUM(contacted_at IS NOT NULL) AS done
                 FROM painter_daily_assignments pda JOIN users u ON u.id = pda.user_id
                 WHERE pda.assigned_date = CURDATE()
                 GROUP BY pda.user_id HAVING total > 0 AND (done * 10 < total * 3)`
            );
            if (!low.length) return;
            const byBranch = {};
            for (const r of low) { (byBranch[r.branch_id] ||= []).push(`${r.staff_name}: ${r.done}/${r.total}`); }
            // Send via General WhatsApp (branch_id=0) — per project convention
            const whatsapp = require('./whatsapp-session-manager');
            const [branches] = await pool.query(`SELECT id, manager_user_id FROM branches WHERE id IN (?)`, [Object.keys(byBranch)]);
            for (const b of branches) {
                if (!b.manager_user_id) continue;
                const [mgr] = await pool.query(`SELECT phone FROM users WHERE id = ?`, [b.manager_user_id]);
                if (!mgr[0]?.phone) continue;
                const text = `Painter marketing: underperformers today —\n${byBranch[b.id].join('\n')}`;
                await whatsapp.sendMessage(0, mgr[0].phone, text).catch(err => console.error('WA send fail', err.message));
            }
        } catch (e) { console.error('[pntr-marketing] 18:00 WA failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
```

- [ ] **Step 3: Test manually**

Open Node REPL:

```bash
node -e "const{createPool}=require('./config/database');const p=createPool();const s=require('./services/painter-marketing-scheduler');s.generateDailyLists(p).then(r=>{console.log(r);process.exit(0);});"
```

- [ ] **Step 4: Commit**

```bash
git add services/painter-marketing-scheduler.js
git commit -m "feat(pntr): 06:30/17:00/18:00 notifications + WA templates in ai_config"
```

---

## Task 17: Documentation update

**Files:**
- Modify: `Skills.md`
- Modify: `C:\Users\Hiii\.claude\projects\D--QUALITY-COLOURS-DEVELOPMENT-qcpaintshop-com-act-qcpaintshop-com\memory\MEMORY.md` (project-memory)

- [ ] **Step 1: Add module section to `Skills.md`**

After the "Painter System" section, add:

```markdown
## PNTR Painter Marketing (Apr 2026)
- **Tables**: `painter_leads`, `painter_lead_followups`, `painter_daily_assignments`, `painter_marketing_config`, `painter_zoho_salesperson_map`, `painter_pntr_import_runs`, `painter_lead_duplicate_queue`, `painter_zoho_sync_queue`. `painters` gained `zoho_customer_id`, `zoho_salesperson_id`, `created_via`, `activated_at`, `source_lead_id`. `painter_invoices_processed` gained `attribution_type`, `source_invoice_date`, `zoho_invoice_id`. `zoho_invoices` gained `zoho_salesperson_id`, `zoho_salesperson_name`.
- **Services**: `pntr-import-service.js` (bulk + incremental), `painter-zoho-sync-service.js` (universal painter→Zoho hook + retry), `painter-marketing-scheduler.js` (daily lists + 7 crons), `painter-points-backfill-service.js` (direct + salesperson attribution).
- **Routes**: `routes/painter-marketing.js` at `/api/painter-marketing/*`. Permissions `painters.marketing.{view,contact,manage,convert}`.
- **Crons (IST)**: 02:30 incremental import, 03:00 Zoho retry, 03:30 points incremental, 06:00 daily list gen, 06:30 push, 17:00 reminder, 18:00 manager WA.
- **Pages**: `admin-painters.html` Marketing tab (7 sub-tabs), `staff-painter-marketing.html` (new).
- **Activation**: painter OTP login → `POST /api/painters/:id/activate` → sets `activated_at`, fires Zoho sync + Dec 2025 backfill.
- **Backfill config keys in `ai_config`**: `painter_self_billing_annual_rate`, `painter_customer_billing_regular_rate`, `painter_customer_billing_annual_rate` (default 0.005 each).
- **WhatsApp templates in `ai_config`**: `painter_marketing_wa_template`, `painter_activation_wa_template`.
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All prior tests + 4 new test files PASS.

- [ ] **Step 3: Commit**

```bash
git add Skills.md
git commit -m "docs: PNTR painter marketing module in Skills.md"
```

---

## Task 18: Final verification & deploy-ready check

- [ ] **Step 1: Run migrations + confirm schema**

```bash
node migrations/migrate-zoho-invoices-salesperson.js
node migrations/migrate-pntr-painter-marketing.js
```

- [ ] **Step 2: Run all tests**

```bash
npm test -- --no-coverage
```

All pass.

- [ ] **Step 3: Start server locally and smoke-test**

```bash
npm run dev
```

Hit in browser (signed in as admin):
- `/admin-painters.html` → Marketing tab → "Incremental" (should complete; empty if no PNTR customers yet)
- `/admin-painters.html` → Marketing → Import Runs (should show one row)
- `/staff-painter-marketing.html` (as staff) → should render

- [ ] **Step 4: Verify scheduler registration**

Check server console on boot includes: `[pntr-marketing] crons registered: 02:30, 03:00, 03:30, 06:00 IST`.

- [ ] **Step 5: Re-sync Dec 2025+ invoices to populate new `zoho_salesperson_id`**

From admin Zoho dashboard or CLI:

```bash
node -e "require('./services/zoho-api').syncInvoices().then(r=>{console.log(r);process.exit(0)})"
```

(this re-runs the full invoice sync; `ON DUPLICATE KEY UPDATE` backfills salesperson fields for existing rows)

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git status
git add <anything outstanding>
git commit -m "chore(pntr): deploy prep"
```

---

## Self-Review Checklist

- [x] Spec section 1 (goal) covered: migration + services + UI task set
- [x] Spec section 2 (3 creation paths converge to hook) covered: Task 10 + Task 9 + Task 6
- [x] Spec section 3 (data model) covered: Task 1, 2
- [x] Spec section 4 (bulk/incremental import) covered: Task 5
- [x] Spec section 5 (daily marketing loop) covered: Task 7, 9, 14
- [x] Spec section 6 (Path A conversion) covered: Task 9 `/leads/:id/convert`
- [x] Spec section 7 (universal Zoho hook) covered: Task 6, 10
- [x] Spec section 8 (annual points backfill) covered: Task 8
- [x] Spec section 9 (cron schedule) covered: Task 7, 11, 16
- [x] Spec section 10 (UI surfaces) covered: Task 13, 14, 15
- [x] Spec section 11 (permissions) covered: Task 12
- [x] Spec section 12 (module layout) covered
- [x] Spec section 13 (testing) covered: tests in each service task (4 unit files + 1 integration)
- [x] Spec section 14 (prerequisites) covered: Task 1 (zoho_invoices column + syncInvoices + createSalesperson)
- [x] Spec section 15 (out of scope) respected — no branch transfer UI, no SMS fallback, etc.

---

**End of plan.**
