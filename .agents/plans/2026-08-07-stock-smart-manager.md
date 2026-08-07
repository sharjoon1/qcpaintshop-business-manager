# Plan: Smart Stock Manager — Branch/Category/Brand, Valuation, Dead-Stock & Smart Check

## Goal
Tamil requirement: *enthentha branchla ennenna materials evlo sales nadakkuthu atharketravaaru stock maintain pannanum, Automatic reorder suggestion brand wise & category wise, overall current stock value branch wise & total, romba naal sales aagatha product kandupidikanum, entha productum stock miss aagama smart stock check.*

One hub-la: branch-wise sales → reorder, value, dead-stock, smart check.

## Success Criteria
- Admin Stock Hub la per-branch sales (7/30/90d) + stock qty/value side-by-side paarka mudiyum
- Automatic reorder suggestion brand wise & category wise filter + suggestedQty (`reorderLevel - currentStock`) paarka mudiyum, nightly recompute
- Overall current stock value branch wise + total (₹) + donut/branch table 60s refresh
- Dead-stock list: no sales in 30/60/90 days (configurable) + last sale date, branch-wise
- Smart Stock Check: 1-click la `critical + low_stock ≤5 + dead>60d + below reorder` auto queue → `POST /api/stock-check/assign` creation <3 clicks

## Context And Current Facts
- **Routes:** `routes/stock-check.js` (assign, list, review), `routes/stock-migration.js` (warehouse→business), `routes/zoho/` split `items.js` (`GET /api/zoho/stock`, `/stock/by-location`, `/stock/filter-options`, `/stock/:itemId`, `/stock/history`, `POST /stock/sync`), `reorder.js` (`GET /reorder/alerts`, `/reorder/alerts/summary`, `/reorder/config`, `POST /reorder/check`, `GET /reorder/brands/available`, brand config), `sync-config.js` (locations)
- **Services:** `services/reorder-compute-service.js` (`computeReorderLevel(avgDaily*(lead+safety))`, `computeReorderQuantity(avgDaily*15)`, `computeSeverity`, `computeAll(windowDays=60,minSales=1)`, brand config `brand_reorder_config` with `__default__ lead 7 safety 5`), `services/purchase-suggestion.js` (three-tier `globalReorderLevel=(totalSales/days)*30*numBranches`, `branchThreshold=max(minStock, global*allocPct/100)`, `suggestedQty=(threshold-stock)*multiplier`, fallback category default), `services/zoho-api.js` (`getLocationStockDashboard`, `getReorderDashboard`, `checkReorderAlerts`, `syncLocationStock`), `services/reorder-report-service.js` + PDF
- **Tables:** `zoho_location_stock (zoho_item_id, zoho_location_id, stock_on_hand, item_name, sku)`, `zoho_items_map (zoho_brand, zoho_category_name, zoho_rate, zoho_item_name)`, `zoho_reorder_config / zoho_reorder_alerts (severity critical/high/medium/low)`, `brand_reorder_config`, `zoho_branch_allocations`, `zoho_category_defaults`, `branch_item_sales (local_branch_id, zoho_item_id, sale_date, qty_sold)`, `zoho_invoice_line_items`, `zoho_invoices`, `stock_check_assignments / stock_check_items`
- **Frontend:** `public/admin-stock-hub.html` (new, 5 tabs Overview/Stock/Reorder/Checks/Migrate, 52KB), `public/admin-zoho-stock.html` (stock table, location tabs), `public/admin-zoho-reorder.html` (alerts), `public/admin-stock-check.html` (assign + review), `public/staff/stock-check.html` (stepper `stepQty` + 1.2s auto-save), `public/js/nav/zoho-subnav.js` (Stock Hub pill), `public/css/zoho-common.css`, `public/js/stock-filters.js`
- **Verified:** `npm run lint` 0 errors (309 warnings pre-existing), headless Chromium 1280×900: tabs switch 740-762ms vis true, `Sync Stock` 439ms, `Check Reorder` 455ms, `FPS 61`, stepper dummy `5→6→5` pass, live `curl -I https://act.qcpaintshop.com/admin-stock-hub.html` `200 OK` + `getAuthHeaders` fix `46605b5` deployed
- **Docs:** `Skills.md` living doc, `docs/PROJECT-REPORT-2026-06-10.md` survey, `CLAUDE.md` §6 money paths (GST inclusive, R10 rounding, Sunday OT×2, 10h day) — reorder math not money-critical but valuation uses `stock_on_hand * zoho_rate`

## Constraints And Non-goals
- **Constraints:** `ZOHO_ORGANIZATION_ID` gate for zoho sync/reorder, `isClusterPrimary()` single pm2 fork, `express.static('public')` + `404.html` catch-all, auth `getAuthHeaders()` `Bearer` + `requirePermission('zoho', ...)`, MySQL UTC `+00:00` offset, `ALGORITHM=INPLACE LOCK=NONE` for migrations
- **Non-goals:** No Zoho CRM, no WMS beyond stock check, no HR beyond attendance, no new Zoho Inventory Transfer Orders scope (keep paired adjustments), no change to GST/R10/salary math (§6), no purple gradients / AI slop visuals

## Key Decisions
1. **Extend Stock Hub (not new page):** Reuse `admin-stock-hub.html` 5-tab shell, add `Dead Stock` as 6th tab or sub-tab in Stock Levels — less nav churn vs new route. Rejected: separate `admin-dead-stock.html` (adds 6th Zoho subnav, duplicates filters)
2. **Single reorder compute unified on `branch_item_sales`:** Keep `reorder-compute-service.computeAll` (60d, brand lead/safety) as primary, deprecate dual `purchase-suggestion` global*allocPct for hub suggestions but keep service for `admin-zoho-purchase-suggestions.html` compat. Rationale: branch sales already segmented, simpler than global*branches.
3. **Valuation on `zoho_location_stock.stock_on_hand * zoho_items_map.zoho_rate`:** Server computes `SUM(stock_on_hand*rate)` per location + total, cached 60s. Rejected: Zoho API valuation (slow, quota).
4. **Dead-stock on `branch_item_sales` + `zoho_invoice_line_items`:** Query `NOT EXISTS sales in last N days` per branch+item, `N=30/60/90` selectable, show `last_sale_date`. Window `N` param, not fixed.
5. **Smart Check = server-generated queue, not cron auto-assign:** Button `Smart Check: Auto-queue` collects `critical + low≤5 + dead>60 + below reorder` (deduped) → `pendingCheckItems` → existing `POST /api/stock-check/assign` flow. Nightly cron auto-assign optional phase-2 (requires staff auto-select, skipped v1).
6. **Filters reuse `stock-filters.js` + server `brand/categories`:** Add `brand`/`category` query params to `GET /api/zoho/reorder/alerts` and new `GET /api/zoho/stock/valuation` + `GET /api/zoho/stock/dead`. Client reuses `StockFilters` brandCategories map.

## Recommended Approach
- **Phase 1 (this plan, 1 week, 1 commit):** Branch sales + valuation + dead-stock + smart check inside Stock Hub, + 3 read-only APIs, no schema migration (use existing tables), nightly reorder compute already at `30 2 * * *`.
- **Data flow:** `zoho_location_stock` (current) + `zoho_items_map` (brand/category/rate) + `branch_item_sales` / `zoho_invoice_line_items` (sales window) → compute `avgDaily`, `reorderLevel`, `suggestedQty`, `severity` on read + `GET /api/zoho/stock/valuation` + `GET /api/zoho/stock/dead?days=&brand=&category=&branch_id=` + extend `GET /api/zoho/reorder/alerts?brand=&category=` → Hub tabs render + Smart Check queues → `POST /api/stock-check/assign`.
- **Reuse:** `reorder-compute-service` helpers, `zoho-api.getReorderDashboard/getLocationStockDashboard`, `stock-filters.js`, existing `zoho-stock-hub` tab infra, `staff/stock-check.html` stepper.

## Work Plan
**Unit 1 — APIs (read-only, no migration)**
- `GET /api/zoho/stock/valuation` (auth `zoho:view`): per `zoho_location_id` `SUM(stock_on_hand * zoho_rate)` + total, `brand`/`category` optional filter via `JOIN zoho_items_map`, cache 60s. File: `routes/zoho/items.js` (+ `shared.getCached/setCache`).
- `GET /api/zoho/stock/dead` (auth `zoho:view`): `branch_id`/`location_id`, `days=30/60/90`, `brand`, `category`, `search`, `page/limit`, `sort=last_sale_asc/name_asc`, returns `zoho_item_id, item_name, sku, stock_on_hand, last_sale_date, days_since_sale`. Query `branch_item_sales` grouped, `HAVING MAX(sale_date) < NOW()-INTERVAL ? DAY OR NULL`. File: `routes/zoho/items.js`.
- `Extend GET /api/zoho/reorder/alerts` to accept `brand`/`category` (JOIN `zoho_items_map` filter) + `branch_id` via location map. File: `routes/zoho/reorder.js` (via `zoho-api.getReorderDashboard` pass-through).
- `Extend GET /api/zoho/stock/valuation & dead` to support `brand`/`category` consistent.

**Unit 2 — Hub UI (Stock Hub extension, no new route)**
- **Overview:** Add `Branch Value` donut/table (per branch `₹`, total) + `Sales sparkline (7d/30d)` per location (spark from `GET /api/zoho/stock/valuation?group=branch` + new `GET /api/zoho/reports/branch-sales?days=30` if exists else aggregate `branch_item_sales` fallback).
- **Stock Levels:** Add `Brand [All]` `Category [All]` selects (reuse `GET /api/zoho/stock/filter-options` `brandCategories`), `Value` column already, keep location chips.
- **Reorder:** Add same `Brand/Category` filters above `All status/severity`, `suggestedQty` column, keep bulk `Add to Stock Check`.
- **Dead Stock (new tab `Dead` or pane `pane-dead`):** `Days [30|60|90]` toggle, `Brand/Category` filters, table `Item | Stock | Last sale | Days ago | Location`, bulk `Add to Smart Check`, pagination. Reuse `qc-table` + `location-chip`.
- **Smart Check button:** In `Reorder` + `Dead` + `Stock Levels` bulk bars, add `Smart Check: Auto-queue (critical+low+dead+below)` → dedup `zoho_item_id` → `pendingCheckItems` → `switchTab('checks')` + `openCreateCheck()` (already patched). Show count badge `N items queued`.

**Unit 3 — Polish & wiring**
- `public/js/nav/zoho-subnav.js` — no change (Hub pill already). 
- Error handling: replace `Failed: HTTP 404` raw with `No data — Sync Stock or check filters` empty states.
- `staff/stock-check.html` — no change (stepper already).
- Docs: update `Skills.md` after.

**Dependencies:** Unit 1 → Unit 2 (APIs before UI). Unit 3 parallel polish.

## Validation Plan
- **Unit 1 APIs:** `curl -H "Authorization: Bearer $TOKEN" "https://act.qcpaintshop.com/api/zoho/stock/valuation?group=branch"` → `200` `{perBranch:[{location_id,value}], total}`; `curl ".../stock/dead?days=60&branch_id=1&brand=Asian%20Paints"` → `200` list with `last_sale_date`; `curl ".../reorder/alerts?brand=Berger&category=Emulsion"` filtered; `npm run lint` 0 errors.
- **Unit 2 Hub:** Headless Chromium `http://127.0.0.1:8282/admin-stock-hub.html` (mock admin `localStorage`) + live `https://act.qcpaintshop.com/admin-stock-hub.html` (real login via `admin` creds or mocked `auth_token` + `page.route` mock for APIs) — drive `Overview` → `Stock Levels` (location chip, Brand/Category select, Search, Low only, Filters) → `Reorder` (All status, severity, Brand/Category, Acknowledge) → `Dead` (30/60/90 toggle, Add to Smart Check) → `Migrate` → `Sync Stock` (Authorization header `Bearer` present via `page.route` intercept, no 401 toast) → `Check Reorder` → `New Stock Check` (Branch→Location auto, Staff, Date, Show system qty, search add, Create → `POST /api/stock-check/assign` 200, Review slide Diff, `Smart Check Auto-queue` count) — capture 6 screenshots + `rAF FPS 60` 1s, `tab switch <800ms`.
- **Manual:** Admin login → Hub → Branch Value total matches Zoho stock value, Dead list `last sale >60d` correct vs Zoho invoices, Smart Check creates assignment with deduped items visible in `Stock Checks` list.

## Risks / Rollback
- **Risk:** `branch_item_sales` window 60d may miss seasonal (festival) → `days` param mitigates, keep `purchase-suggestion` fallback for low-volume. **Rollback:** Hub UI is additive, APIs read-only — revert single commit `git revert <hash>` restores old hub, no DB change.
- **Risk:** Valuation `stock_on_hand*rate` drift vs Zoho (R10 rounding) — accepted NIT-1, display note. **Rollback:** same.
- **Risk:** Dead query heavy on `branch_item_sales` (10K rows) — add `INDEX (zoho_item_id, local_branch_id, sale_date)` if slow, `LIMIT 50` pagination. **Rollback:** add index is additive, drop if needed.
- **Compat:** Existing `admin-zoho-stock.html`, `admin-zoho-reorder.html`, `admin-stock-check.html`, `admin-zoho-purchase-suggestions.html` untouched.

## Open Questions
- **None** — all APIs/tables verified in repo. `branch_item_sales` population via `zoho-invoice-line-sync` verified `services/zoho-invoice-line-sync.js`. Sales source for valuation: prefer `branch_item_sales` (already aggregated per branch+item+date) over raw `zoho_invoice_line_items` for branch filter correctness — confirmed.
