# Reorder Intelligence — Design Spec

**Date**: 2026-04-14
**Status**: Approved, ready for implementation plan
**Project**: QC Paint Shop Business Manager (act.qcpaintshop.com)

---

## 1. Goal

Analyze per-branch per-item sales velocity from Zoho invoice line items, auto-compute per-branch reorder levels using a brand-aware lead-time formula, and deliver a daily branch-wise reorder report to branch managers and admins via dashboard, WhatsApp, and FCM — with inter-branch stock visibility so a manager can spot available stock in another branch before placing a vendor order.

## 2. Scope

### In scope
- Per-branch per-item daily sales aggregation, synced from Zoho invoice line items
- Per-brand lead time + safety days configuration
- Nightly auto-compute of reorder levels (hybrid: respects manual overrides)
- Severity-tiered alerts (critical / high / medium / low)
- Daily reorder report at 07:00 IST: dashboard + WhatsApp PDF + FCM push
- Branch-wise routing: managers get their branch, admin + purchase manager get consolidated
- Report includes "stock in other branches" column for every reorder item
- Three new admin UI tabs + enhancements to two existing tabs
- Branch-manager scoped access via middleware

### Out of scope
- Automatic purchase order generation (report is informational; human places PO)
- Inter-branch transfer workflow (only visibility — transfer request UI is a future feature)
- Vendor integration (no direct vendor email/portal)
- Demand forecasting beyond 60-day rolling average (no seasonality model)

## 3. Non-goals

- Replace manual reorder configuration entirely — manual rows must remain protected from auto overwrite
- Predict future stockouts beyond simple `days_to_stockout = stock / avg_daily_sales`
- Generate vendor POs directly from this feature

## 4. Architecture

```
[Zoho Books]
     │
     │  1. Invoice line-item sync (new)
     ▼
[branch_item_sales]  ← per (branch × item × date) aggregates
     │
     │  2. Sales velocity computation (nightly)
     ▼
[reorder_compute_service]
     │  reads: branch_item_sales (60d avg), zoho_location_stock,
     │         brand_reorder_config (lead+safety per brand),
     │         zoho_reorder_config (manual overrides — respected)
     │  writes: zoho_reorder_config (auto rows), zoho_reorder_alerts
     ▼
[reorder_report_service]  (07:00 IST daily)
     │  joins: alerts × stock-across-branches × recipients
     ├──► Dashboard (admin-zoho-reorder.html new "Daily Report" tab)
     ├──► WhatsApp (branch manager → their branch; admin → consolidated PDF)
     └──► FCM push (same routing)
```

Three new services, three new scheduler jobs, all registered via existing `automation-registry`.

## 5. Data Model

### 5.1 New: `branch_item_sales`
Per (branch × item × date) sales aggregate. Upserted nightly from Zoho invoice line items.

```sql
CREATE TABLE branch_item_sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    local_branch_id INT NOT NULL,
    zoho_item_id VARCHAR(50) NOT NULL,
    sale_date DATE NOT NULL,
    qty_sold DECIMAL(12,2) NOT NULL DEFAULT 0,
    revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
    invoice_count INT NOT NULL DEFAULT 0,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bis (local_branch_id, zoho_item_id, sale_date),
    KEY idx_item_date (zoho_item_id, sale_date),
    KEY idx_branch_date (local_branch_id, sale_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 New: `brand_reorder_config`
Per-brand lead time + safety days. Unknown brands fall back to `__default__`.

```sql
CREATE TABLE brand_reorder_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(100) NOT NULL,
    lead_time_days INT NOT NULL DEFAULT 7,
    safety_days INT NOT NULL DEFAULT 5,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    updated_by INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_brand (brand_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days)
VALUES ('__default__', 7, 5);
```

### 5.3 New: `invoice_line_sync_cursor`
Tracks which invoices have had their line items fetched. Enables resumable back-fill.

```sql
CREATE TABLE invoice_line_sync_cursor (
    invoice_id VARCHAR(50) PRIMARY KEY,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    line_count INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.4 New: `reorder_report_log`
Per-day per-scope audit of report generation. Provides idempotency.

```sql
CREATE TABLE reorder_report_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    report_date DATE NOT NULL,
    scope VARCHAR(50) NOT NULL,         -- 'branch:3' or 'consolidated'
    items_count INT NOT NULL,
    delivery_status JSON,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_date_scope (report_date, scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.5 Extend: `zoho_reorder_config`
Tag each row as manual or auto-computed, store last velocity used.

```sql
ALTER TABLE zoho_reorder_config
    ADD COLUMN source ENUM('manual','auto') NOT NULL DEFAULT 'manual',
    ADD COLUMN avg_daily_sales DECIMAL(10,3) NULL,
    ADD COLUMN computed_at TIMESTAMP NULL;
```

**Hybrid apply rule**: compute service writes only rows with `source='auto'` or rows that don't yet exist. Rows with `source='manual'` are never auto-overwritten. Admin UI shows badge; "Reset to auto" bulk action switches selected manual rows back to auto.

## 6. Services

### 6.1 `services/zoho-invoice-line-sync.js`

**Purpose**: Fetch invoice line items from Zoho and aggregate into `branch_item_sales`.

**Flow**:
1. Determine sync window:
   - If `branch_item_sales` empty → back-fill last 90 days
   - Else → sync from `MAX(sale_date) - 1 day` to yesterday
2. Query `zoho_invoices` WHERE `invoice_date` IN window AND `local_branch_id IS NOT NULL`
3. For each invoice (rate-limited, resumable):
   - Skip if already in `invoice_line_sync_cursor`
   - Call Zoho: `GET /invoices/{invoice_id}` → returns `line_items[]`
   - For each line item (`item_id`, `quantity`, `item_total`): UPSERT `branch_item_sales`
   - Mark cursor row
4. On rate-limit / 429 / error 45 / error 57 → stop batch, resume next run

**Rate limiting**: reuses existing `services/zoho-api.js` rate limiter + circuit breaker.

**Initial back-fill**: triggered from admin UI button. Runs in background; progress emitted via Socket.io. ~10 minutes for 90 days (~4,500 invoices).

**Daily run**: 02:00 IST via `automation-registry`. Typical volume ~50 invoices = ~1 minute.

**Endpoints**:
- `POST /api/zoho/reorder/backfill-sales` — admin trigger
- `GET /api/zoho/reorder/sales-sync-status` — progress + last run + errors

### 6.2 `services/reorder-compute-service.js`

**Purpose**: Compute per-branch per-item reorder levels and refresh alerts.

**Algorithm**:
```
For each (local_branch_id, zoho_item_id) present in branch_item_sales
WHERE sale_date >= TODAY - 60 days:

  1. avg_daily_sales = SUM(qty_sold) / 60
     (fixed 60-day divisor — conservative for new items)

  2. If avg_daily_sales < reorder_min_sales_for_auto (default 1/60 = 0.0167) → skip

  3. brand = zoho_items_map.zoho_brand for this item
     lead, safety = brand_reorder_config WHERE brand_name = brand
                    OR WHERE brand_name = '__default__'

  4. reorder_level = CEIL(avg_daily_sales × (lead + safety))
     reorder_quantity = CEIL(avg_daily_sales × 15)   -- 15-day replenish pack

  5. Hybrid apply:
       SELECT source FROM zoho_reorder_config
         WHERE zoho_item_id=? AND zoho_location_id=?
       IF found AND source='manual' → SKIP
       ELSE → UPSERT with source='auto', avg_daily_sales, computed_at=NOW()

  6. Evaluate alert against zoho_location_stock:
       current_stock = stock_on_hand for (item, location)
       IF current_stock <= reorder_level:
         UPSERT zoho_reorder_alerts with severity (see below)
       ELSE:
         UPDATE existing active alert → status='resolved'
```

**Severity tiers**:
```
stock_ratio = current_stock / reorder_level
  ratio <= 0.25  → critical
  ratio <= 0.50  → high
  ratio <= 0.75  → medium
  ratio <= 1.00  → low
```

**Run logging**: one row per run in `zoho_sync_log` with `sync_type='reorder_compute'`.

**Triggers**:
- Nightly 02:30 IST (after invoice-line sync finishes)
- Manual: `POST /api/zoho/reorder/compute-now`

### 6.3 `services/reorder-report-service.js`

**Purpose**: Assemble daily report from existing alerts and deliver to recipients.

**Report row (core unit)**:
```js
{
  item_name, sku, brand, unit,
  branch_name, current_stock, reorder_level, severity,
  avg_daily_sales, days_to_stockout,
  suggested_order_qty,
  other_branches: [
    { branch_name, stock_on_hand, available_for_sale }, ...
  ]
}
```

**Other-branches query**: for each item, subquery `zoho_location_stock` for all branches with `stock_on_hand > 0`, excluding the report's target branch, sorted by `stock_on_hand` desc.

**Scopes**:

1. **Per-branch** — for each branch with active alerts:
   - Filter: that branch's alerts only
   - Sort: severity desc, then days_to_stockout asc
   - Recipient: `branches.manager_id` → FCM + WhatsApp

2. **Consolidated** — admin + purchase manager:
   - All branches' alerts, grouped by branch, then severity
   - Recipients: users listed in `ai_config.reorder_report_recipients` (JSON array)

**Delivery channels**:

- **Dashboard**: new "Daily Report" tab in `admin-zoho-reorder.html`. Date picker, branch filter, expandable rows showing other-branches.
- **WhatsApp**: via `services/notification-service.js` using general WA session. Summary text + PDF attachment. PDF generated via PDFKit, green/gold branding.
- **FCM push**: via `fcm-admin.sendToDevice()`. Title/body + deep link + 24h TTL.

**Idempotency**: `reorder_report_log` insert BEFORE sending. Duplicate run same day → skip unless `force=1`.

**Failure handling**: each channel logged independently in `delivery_status` JSON. Dashboard always succeeds (pure DB read).

**Triggers**:
- 07:00 IST daily
- Manual: `POST /api/zoho/reorder/run-report?date=...&scope=all|branch-id&force=1`

## 7. Scheduler

Register three new jobs via existing `automation-registry`:

| Key | Schedule (IST) | Service |
|-----|---------------|---------|
| `invoice-line-sync` | 02:00 | `services/zoho-invoice-line-sync.js` |
| `reorder-compute` | 02:30 | `services/reorder-compute-service.js` |
| `reorder-report` | 07:00 | `services/reorder-report-service.js` |

Timezone: `Asia/Kolkata`. Cron expressions in 6-field form consistent with existing jobs (e.g. `0 0 2 * * *`).

## 8. UI

File: `public/admin-zoho-reorder.html` (extend existing).

### 8.1 New tab: Daily Report
- Date picker (default today)
- Branch filter dropdown (auto-filtered for non-admin managers)
- Main table: severity badge · item · SKU · branch · current stock · reorder level · days-to-stockout · suggested order qty
- Expandable row: "Other Branches" mini-table — branch → stock (only branches with stock > 0)
- "Download PDF" button (per-branch or consolidated)
- "Re-run Report" admin button (manual trigger, `force=1`)

### 8.2 New tab: Brand Config
- Grid: Brand · Lead time · Safety · Active · Updated by · Item count
- Inline add/edit
- `__default__` row locked (can edit values, can't delete)

### 8.3 Enhanced tab: Configuration
- New columns: **Source** badge (🤖 Auto / 👤 Manual), **Avg daily sales (60d)**, **Computed at**
- Clicking Source badge toggles the row between manual and auto
- Bulk action: "Reset to auto" on selected manual rows

### 8.4 New tab: Sales Analysis
- Filters: branch, brand, category, date range
- Table: item · branch · 60d sales qty · avg daily sales · current stock · days-to-stockout · auto reorder level
- Sort by velocity desc
- Export CSV

### 8.5 Global page additions
- Admin-only banner: last sales sync · last compute run · next scheduled
- Back-fill button (shown when `branch_item_sales` is empty): async job with Socket.io progress bar

### 8.6 Mobile
- Tables collapse to cards on `< 768px`
- Other-branches sub-table renders as inline chips

## 9. Permissions

Reuse existing `zoho.reorder` permission. Add sub-action:
- `zoho.reorder.manage` — brand config edits, back-fill trigger, force report, reset-to-auto bulk action

**Branch-manager scoping**: middleware reads `req.user.role` and `branches WHERE manager_id = req.user.id`. Filters `local_branch_id` on list endpoints so a manager sees only their branch data.

## 10. Config keys (`ai_config`)

| Key | Default | Purpose |
|-----|---------|---------|
| `reorder_sales_window_days` | 60 | Averaging window |
| `reorder_min_sales_for_auto` | 1 | Total 60d qty below which auto is skipped |
| `reorder_invoice_sync_time` | `"02:00"` | Daily cron |
| `reorder_compute_time` | `"02:30"` | Daily cron |
| `reorder_report_time` | `"07:00"` | Daily cron |
| `reorder_report_recipients` | `"[]"` | JSON array of user IDs for consolidated |
| `reorder_report_whatsapp_enabled` | `0` | Toggle off until verified |
| `reorder_report_fcm_enabled` | `0` | Toggle off until verified |
| `reorder_report_pdf_enabled` | `1` | Attach PDF to WhatsApp |

## 11. Endpoints

```
# Sales sync
POST   /api/zoho/reorder/backfill-sales
GET    /api/zoho/reorder/sales-sync-status

# Compute
POST   /api/zoho/reorder/compute-now

# Brand config
GET    /api/zoho/reorder/brands
POST   /api/zoho/reorder/brands
PUT    /api/zoho/reorder/brands/:id
DELETE /api/zoho/reorder/brands/:id

# Reports
POST   /api/zoho/reorder/run-report
GET    /api/zoho/reorder/report?date=YYYY-MM-DD&branch_id=N
GET    /api/zoho/reorder/report/pdf?date=...&branch_id=...

# Sales analysis
GET    /api/zoho/reorder/sales-analysis?branch_id=&brand=&category=&from=&to=

# Configuration enhancements (existing endpoint extended)
POST   /api/zoho/reorder/config/reset-to-auto  (body: { items: [...] })
```

All require `requirePermission('zoho', 'reorder')`. Mutations on brand config + back-fill + force report require `zoho.reorder.manage`.

## 12. Migration

File: `migrations/migrate-reorder-intelligence.js`

Idempotent migration that:
1. Creates `branch_item_sales` (if not exists)
2. Creates `brand_reorder_config` (if not exists) + seeds `__default__` (7, 5)
3. Creates `invoice_line_sync_cursor` (if not exists)
4. Creates `reorder_report_log` (if not exists)
5. Adds `source`, `avg_daily_sales`, `computed_at` columns to `zoho_reorder_config` (if not already present)
6. Seeds `ai_config` keys (INSERT IGNORE to preserve any manual changes)

Uses same pattern as other migrations: dotenv, mysql2/promise pool, INFORMATION_SCHEMA checks before ALTERs.

## 13. Rollout order

Each step gates the next:

1. **Migration** — schema + defaults (invisible to users)
2. **Brand Config UI tab** — admin sets vendor lead times before compute runs
3. **Invoice-line sync service** — deploy, trigger back-fill from admin UI (one-time ~10 min)
4. **Compute service** — deploy; first run manual via UI; admin reviews output
5. **Daily Report tab** — admin can view; WhatsApp/FCM still disabled in config
6. **Enable delivery channels** — flip `reorder_report_whatsapp_enabled` + `_fcm_enabled` to 1
7. **Register crons** via automation-registry
8. **Monitor first week** — check `reorder_report_log`, tune brand lead times

## 14. Testing

Jest tests under `tests/unit/`:

- `reorder-compute.test.js` — formula correctness, brand fallback to `__default__`, hybrid override respect (manual rows untouched), zero-sales skip, severity tier boundaries
- `invoice-line-sync.test.js` — cursor resumability after restart, upsert idempotency, rate-limit graceful stop
- `reorder-report.test.js` — branch routing, other-branches lookup (excludes own branch, only positive stock), consolidated grouping, idempotency via `reorder_report_log`
- `brand-config.test.js` — default fallback, CRUD validation

Target: 90%+ coverage on the three new services.

## 15. Observability

- Each cron run inserts a row in `zoho_sync_log` with `sync_type` set to `invoice_line_sync`, `reorder_compute`, or `reorder_report`
- `reorder_report_log` tracks delivery per channel
- Admin banner surfaces last run times
- Failures logged via existing `error-prevention-service.js` with severity `warn` (graceful degrade) or `error` (full stop)

## 16. Known limitations

- Zoho invoice API does not expose a bulk line-items endpoint — we must fetch invoices one by one. Back-fill time is API-bound, not CPU-bound.
- 60-day window ignores seasonal paint demand (monsoon vs summer). Future enhancement: seasonal multiplier per brand or per category.
- Inter-branch stock visibility is informational only — no transfer workflow yet.
- New items (< 60 days history) use total_sold / 60 as a conservative average, which can under-order initially. Manual override is the escape hatch.

## 17. Open questions

None at spec approval time. Any issues found during implementation surface as plan-level tasks or follow-up specs.

---

**Approved by user**: 2026-04-14
**Next step**: Invoke `superpowers:writing-plans` skill to produce implementation plan.
