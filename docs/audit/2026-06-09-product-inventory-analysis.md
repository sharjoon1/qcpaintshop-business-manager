# Product & Inventory — Deep Analysis (2026-06-09)

> Read-only 12-surface fan-out + adversarial verification. 39 confirmed bugs (10 P0 / 29 P1), 35 UI/UX findings, 1 false-positive(s) filtered.


## Confirmed bugs (P0)

### P0-1 [correctness/needs-test] Edit Review modal saves the WRONG pack sizes — reads global `packSizes` instead of `editReviewProduct.pack_sizes`
- **loc:** public/admin-products.html:2137 (saveEditReview)
- **impact:** The Edit Product modal that opens from the Zoho Import tab (switchToProductsAndEdit → renderEditReview, which works on editReviewProduct.pack_sizes) saves the unrelated module-level `packSizes` global. That global only holds state from the Add/Edit Product modal — it is `[]` on a fresh load or stale data from a *different* product edited earlier. Result: clicking Save Changes on a grouped product overwrites its variants with empty/wrong data, silently destroying the product's pack sizes and Zoho mappings. This is a data-loss / money path (pack sizes carry prices + zoho_item_id mappings). The success alert even reports `data.pack_sizes_saved` from the server, masking the loss.
- **fix:** In saveEditReview, build packSizesData from editReviewProduct.pack_sizes, not the global: `const packSizesData = (p.pack_sizes||[]).map(ps => ({ size: ps.size, unit: ps.unit||'L', base_price: ps.base_price, price: ps.base_price, zoho_item_id: ps.zoho_item_id||null, color_name: ps.color_name||null, color_code: ps.color_code||null }));`
- **evidence:** const packSizesData = packSizes.map(ps => ({ size: ps.size, unit: ps.unit || 'L', base_price: ps.base_price, ... }));  ... available_sizes: JSON.stringify(packSizesData)  // but the whole edit-review flow mutates editReviewProduct.pack_sizes (lines 2023 ps.splice, 2082 .push) and renderEditReviewVariant reads `v` from p.pack_sizes

### P0-2 [xss/additive-safe] Stored XSS — desktop products table interpolates product.name / brand_name / category_name into innerHTML unescaped
- **loc:** public/admin-products.html:882-884 (renderProducts desktop table)
- **impact:** product.name/brand_name/category_name originate from the DB and are seeded from Zoho item sync + the admin import flow (user-editable names in Import Review / Edit Review). A product or brand whose name contains `<img src=x onerror=...>` executes JS in the admin session on the desktop table render. The mobile card render of the same data DOES escape (line 940-941 use escH), proving the omission is a bug not a deliberate trust decision. Same gap applies to the Type/Status/Price cells but those are derived/numeric.
- **fix:** Escape all three: `${escHtml(product.name)}`, `${escHtml(product.brand_name) || 'N/A'}` (escape then default), `${escHtml(product.category_name) || 'N/A'}`. escHtml is already defined at line 676.
- **evidence:** <td class="px-4 py-3 text-sm font-semibold text-gray-900">${product.name}</td>
<td class="px-4 py-3 text-sm text-gray-600">${product.brand_name || 'N/A'}</td>
<td class="px-4 py-3 text-sm text-gray-600">${product.category_name || 'N/A'}</td>

### P0-3 [dead-flow/needs-test] Items table reads unprefixed field names but API returns raw zoho_* columns — every row renders blank
- **loc:** public/admin-item-master.html:818-826 (renderTable) vs routes/item-master.js:231-260 (GET /items)
- **impact:** The main Items List table renders Name/SKU/Brand/Category/Base/DPL/Purchase/Sales as '-' or empty for every row (only the checkbox + 'No SKU'/'No DPL' status badges populate, and even those misfire — see status finding). The edit panel (openEditPanel) also reads item.item_name/sku/brand/dpl, so it opens blank. Core flow of the page is dead.
- **fix:** Either alias the SQL in routes/item-master.js GET /items to the expected names (`zoho_item_name AS item_name, zoho_sku AS sku, zoho_brand AS brand, zoho_category_name AS category, zoho_cf_dpl AS dpl, zoho_purchase_rate AS purchase_rate, zoho_rate AS sales_rate, zoho_description AS description`), or change the frontend to read the zoho_* names. Aliasing the API is lower-risk since multiple consumers (price-calc, manual-match, history) all assume the unprefixed names.
- **evidence:** Frontend: html += '<td ...>' + esc(item.item_name) + ... ; formatINR(item.dpl); formatINR(item.purchase_rate); formatINR(item.sales_rate); renderBrandBadge(item.brand); esc(item.category||'-'); esc(item.base||'-'). Backend SELECT: `zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_category_name, zoho_rate, zoho_purchase_rate, zoho_cf_dpl, ...` returned raw as `items` with NO aliasing/transf

### P0-4 [dead-flow/needs-test] Edit panel + Bulk Edit save: payload field names don't match bulkEditSchema; all edits silently dropped, but UI reports success
- **loc:** public/admin-item-master.html:953-961 (saveEditPanel) & 1012-1017 (applyBulkEdit) vs routes/item-master.js:62-72 (bulkEditSchema) + 308-334 (handler)
- **impact:** Editing an item (name/SKU/DPL/brand/category/base) saves NOTHING, yet showToast('Item updated successfully'). Same for Bulk Edit. brand & category are not even in the schema/handler at all, so those can never be set. Silent data-loss / false-success on a primary admin workflow.
- **fix:** Map frontend keys to the schema/handler keys: send zoho_item_name/zoho_sku/zoho_cf_dpl/zoho_purchase_rate/zoho_description (and add zoho_brand/zoho_category_name to bulkEditSchema + handler), OR rename schema/handler to accept the unprefixed names. Add brand/category columns to the UPDATE. Write a characterization test for the bulk-edit handler before changing.
- **evidence:** Frontend sends { zoho_item_id, item_name, description, sku, base, brand, category, cf_dpl }. bulkEditSchema only whitelists zoho_item_name/zoho_sku/zoho_cf_dpl/zoho_rate/zoho_purchase_rate/zoho_description (Zod strips unknown keys). Handler: `if (item.zoho_item_name !== undefined){...}` etc. — none of the sent keys match, so `fields.length===0`, row skipped, `updated++` never runs, returns res.jso

### P0-5 [dead-flow/needs-test] Price Calculator 'Apply & Sync', Health 'Sync Purchase' & 'Recalculate Sales' send new_dpl but dpl-apply requires `dpl` → 400
- **loc:** public/admin-item-master.html:1660,2185,2191,2217,2223 vs routes/item-master.js:86-93 (dplApplySchema) + 532 (validate(dplApplySchema))
- **impact:** Every price-write path is broken: 'Apply & Sync to Zoho' (Price Calculator), 'Sync Purchase = DPL' and 'Recalculate Sales Prices' (Health Check) all fail with 'Apply failed'/'Sync failed'. No DPL/price update can be pushed from this page. Also body uses dpl_version_id (line 1675) but schema field is version_id — mismatched even if dpl were fixed.
- **fix:** Send `dpl` instead of `new_dpl` in all three callers (and `version_id` instead of `dpl_version_id`), OR rename dplApplySchema fields to new_dpl/dpl_version_id. Lock current dpl-apply behavior with a test first (it's a money path — recalculates ceil(dpl*1.298)).
- **evidence:** Frontend: items.push({ zoho_item_id: item.zoho_item_id, new_dpl: item.new_dpl }). Schema: items: z.array(z.object({ zoho_item_id, dpl: z.number().positive(), version_id })). `dpl` is required and never sent; `new_dpl` is stripped. validate() returns 400 {success:false}.

### P0-6 [dead-flow/needs-test] Auto-Generate Names / Auto-fix Name Format send zoho_item_ids but generate-names requires `brand` → 400
- **loc:** public/admin-item-master.html:1048 (generateNamesSelected) & 2148 (bulkFixNameFormat) vs routes/item-master.js:81-84 (generateNamesSchema) + 387 (validate(generateNamesSchema))
- **impact:** 'Auto-Generate Names' (filter bar + bulk bar) and 'Auto-fix Name Format' (Health Check) both fail with 'Generate failed'. The name-preview modal never opens. Name-standardization feature is fully dead.
- **fix:** Align the contract: either change generate-names to accept { zoho_item_ids: [...] } (and return per-item results the frontend expects: results[].current_name/generated_name/zoho_item_id), or change the frontend to send brand-based generation. The frontend's name-preview also reads r.current_name/r.generated_name — verify the handler returns those exact keys.
- **evidence:** Frontend: body: JSON.stringify({ zoho_item_ids: ids }). Schema: z.object({ brand: z.string().min(1), dry_run: z.boolean().optional().default(true) }). `brand` required+missing; zoho_item_ids stripped. validate() → 400.

### P0-7 [dead-flow/needs-test] Health Check tab reads summary.total_*/issues[type] arrays but API returns totalItems/issuesByType counts + items[] — entire tab shows 0 / empty
- **loc:** public/admin-item-master.html:2028-2102 (renderHealthResults) & 2012-2015 vs routes/item-master.js:740-748 (health-check response)
- **impact:** After 'Run Health Check' completes successfully, the summary strip shows 0 Healthy / 0 Issues / 0 Scanned, every issue section shows count 0 with no rows, and all three bulk-fix buttons stay disabled (they key off issues.<type>.length). The whole Health Check tab is non-functional. bulkFixNameFormat/bulkSyncPurchase/bulkRecalcSales also read healthResults.issues.<type> which is undefined.
- **fix:** Reconcile shapes: change the backend to return { summary:{total_issues, total_scanned}, issues:{ <type>:[{zoho_item_id,item_name,sku,current_value,expected_value,dpl}] } } as the frontend expects, OR rewrite renderHealthResults to consume issuesByType/items. Backend currently doesn't even compute current_value/expected_value/sku — those must be added for the rows + 'Fix' button to be meaningful.
- **evidence:** Frontend reads data.summary.total_issues, data.summary.total_scanned, and data.issues[type] (expected to be an ARRAY of {zoho_item_id,item_name,sku,current_value,expected_value}); enables bulk buttons via issues.bad_name_format.length etc. Backend returns { totalItems, itemsWithIssues (count), issuesByType ({type:count}), items ([{zoho_item_id, zoho_item_name, zoho_brand, issues:[...]}]) } — no `s

### P0-8 [dead-flow/needs-test] DPL PDF parse→match flow is broken: route response shape does not match what the frontend reads
- **loc:** routes/item-master.js:493-529 (dpl-parse, dpl-match) vs public/admin-item-master.html:1276-1295
- **impact:** The entire 'Parse PDF & Auto-Match' DPL import path throws on the client (`Cannot read properties of undefined (reading 'items')`) and the response counts are wrong/NaN on the server. Admins cannot import a price-list PDF at all through this page.
- **fix:** Wrap route responses in the `data` envelope the UI expects and unwrap the parser object. dpl-parse: `const parsed = await parsePriceList(...); res.json({ success: true, data: { count: parsed.items.length, items: parsed.items, brand: parsed.brand } });`. dpl-match: `const { matched, unmatched } = await matchWithZohoItems(parsedItems, zohoItems); res.json({ success: true, data: { matched, unmatched } });`. (Alternatively change the frontend to read top-level fields — but match the existing UI contract.)
- **evidence:** Route dpl-parse: `const parsedItems = await parsePriceList(req.file.buffer, ...); res.json({ success: true, count: parsedItems.length, items: parsedItems });` — but parsePriceList RETURNS AN OBJECT `{ brand, parser, pages, totalExtracted, items }` (price-list-parser.js:828-834), NOT an array, so `parsedItems.length` is undefined and `items:` is the wrapper object. Frontend then does `var parsedIte

### P0-9 [dead-flow/needs-test] DPL apply (core money mutation) rejected by its own zod schema — frontend sends `new_dpl`, schema requires `dpl`
- **loc:** routes/item-master.js:86-93 (dplApplySchema) + 532-548 (dpl-apply) vs public/admin-item-master.html:1660,1674-1680
- **impact:** The 'Apply & Sync to Zoho' button — the action that writes new DPL/purchase/sales prices to zoho_items_map and logs price history — never succeeds from the UI. Price updates cannot be applied. (Also the route accepts `dpl_version_id` from the body but the schema/handler only read `version_id`, so the version stamp is dropped.)
- **fix:** Align names. Either (a) change the schema/handler to accept `new_dpl` and read `item.new_dpl`, plus accept `dpl_version_id`: `const { items, version_id, dpl_version_id } = req.body; const ver = item.version_id || version_id || dpl_version_id || null;`; or (b) change the frontend to send `dpl: item.new_dpl` and `version_id`. Add a characterization test on the price-history + update writes first (§6 money path).
- **evidence:** Schema: `items: z.array(z.object({ zoho_item_id: ..., dpl: z.number().positive(), version_id: z.number().optional() }))`. The route reads `const newPurchase = item.dpl; const newSales = calculateSalesPrice(item.dpl);`. But the frontend builds the payload as `items.push({ zoho_item_id: item.zoho_item_id, new_dpl: item.new_dpl });` (admin-item-master.html:1660) and POSTs `{ items, dpl_version_id }`.

### P0-10 [race/needs-test] Concurrent /adjust/:id pushes duplicate Zoho inventory adjustments (real-money double-counting)
- **loc:** routes/stock-check.js:870-1012 — POST /adjust/:id handler
- **impact:** Two near-simultaneous adjust calls (admin double-click, or retry while the first is still in-flight to Zoho — Zoho calls take seconds) both read the same 'submitted' rows, both build the same line_items, and both POST createInventoryAdjustment. Zoho applies BOTH quantity_adjusted deltas, so physical stock is corrected twice — e.g. a +20 discrepancy becomes +40 in Zoho. This is a direct inventory/money correctness defect. The idempotent() middleware only de-dups identical Idempotency-Key replays; it does NOT protect two distinct submit clicks or a client that omits/regenerates the key.
- **fix:** Make the read-and-claim atomic: inside a transaction, `SELECT ... FOR UPDATE` the submitted rows (or first run `UPDATE stock_check_items SET item_status='adjusting' WHERE assignment_id=? AND item_status='submitted'` and only push the rows that this statement's affectedRows claimed). Push to Zoho only the claimed rows, then flip 'adjusting'->'adjusted'. Alternatively gate the whole handler with a per-assignment advisory lock (GET_LOCK(CONCAT('sc_adjust_',id))).
- **evidence:** router.post('/adjust/:id', idempotent('stockcheck.adjust'), requirePermission('zoho','stock_check'), async (req,res) => { ... const [items] = await pool.query(`SELECT * FROM stock_check_items WHERE assignment_id = ? AND item_status = 'submitted'`, ...); ... const zohoResult = await zohoAPI.createInventoryAdjustment(adjustmentData); ... } — items are only flipped to item_status='adjusted' AFTER the

## Confirmed bugs (P1)

### P1-1 [dead-flow/needs-test] 'Complete'/'DPL Set' status filter sends status=complete which itemsQuerySchema rejects → 400, broken filter
- **loc:** public/admin-item-master.html:86,105,1516 vs routes/item-master.js:57 (itemsQuerySchema status enum) + 190 (validateQuery)
- **impact:** Selecting the 'Complete' status filter or clicking the 'DPL Set' summary card throws → empty state + 'Error loading items' toast. More importantly Price Calculator's loadPriceCalcItems always requests status=complete, so selecting a brand in the Price Calculator ALWAYS 400s → 'Error' toast + empty t
- **fix:** Add 'complete' to the status enum in itemsQuerySchema and implement the WHERE branch (zoho_sku<>'' AND zoho_cf_dpl>0 AND name regexp ok), OR change frontend to a supported status. This is required for the Price Calculator brand-load path to work at all.

### P1-2 [dead-flow/needs-test] Price History timeline/CSV read item_name/sku/brand/version_label but API returns zoho_* + version_brand → rows blank
- **loc:** public/admin-item-master.html:1781-1782,1815,1840-1841,1885,1952-1954 vs routes/item-master.js:661-663 (SELECT)
- **impact:** Price History timeline cards show blank item names, '-' SKUs, group label falls back to empty (label = version_label||brand||'Price Update' → 'Price Update' for every group). CSV export emits empty Item Name/SKU/Brand columns. (old_dpl/new_dpl/old_sales_rate/new_sales_rate come from dph.* so the num
- **fix:** Alias in SQL: zim.zoho_item_name AS item_name, zim.zoho_sku AS sku, zim.zoho_brand AS brand, dv.version_label AS version_label (column exists per dpl_versions). Confirm dpl_price_history actually has old_dpl/new_dpl/old_sales_rate/new_sales_rate columns the timeline reads.

### P1-3 [dead-flow/additive-safe] Per-item price timeline drill-down reads data.data.history but /price-history/:itemId returns data as a flat array → always 'No history'
- **loc:** public/admin-item-master.html:1880 (loadItemTimeline) vs routes/item-master.js:700 (res.json({ success:true, data: rows }))
- **impact:** Clicking any row inside a Price History group to expand its full timeline always shows 'No history for this item' (data.data.history is undefined). The drill-down feature never works even when history exists.
- **fix:** Wrap the per-item response as { success:true, data:{ history: rows } } to match the list endpoint, or change the frontend to read data.data directly. Also note these rows use zoho_* / version_brand names too (esc(history[0].item_name) on line 1885 would be blank).

### P1-4 [correctness/additive-safe] Pagination reads pag.totalPages but API returns pag.pages → pager stuck on page 1
- **loc:** public/admin-item-master.html:857,869,875 (renderPagination) & 1911,1922,1928 (renderHistoryPagination) vs routes/item-master.js:253,680 (pagination.pages)
- **impact:** totalPages defaults to 1, so the 'Next »' button and page-number buttons beyond 1 never render on either the Items List or Price History tabs. With 50 items/page, admins can never page past the first 50 items / first 50 history rows. Data beyond page 1 is unreachable from the UI.
- **fix:** Read pag.pages (or alias the API to also send totalPages). One-line frontend change: var totalPages = pag.totalPages || pag.pages || 1; in both renderPagination functions.

### P1-5 [correctness/additive-safe] 'Brands' summary card renders the brand-name array joined as a string instead of a count
- **loc:** public/admin-item-master.html:706 (loadSummary) vs routes/item-master.js:298 (summary.brands)
- **impact:** The 'Brands' KPI card displays a long comma-joined list of brand names (overflowing the small centered card) instead of the brand count. Looks broken on desktop and badly wraps/overflows on mobile.
- **fix:** Backend should return brands as a count (brandRows.length) for the summary, or frontend should use (summaryData.brands||[]).length.toLocaleString(). Frontend-only fix is safest.

### P1-6 [correctness/additive-safe] Price History date filter ignored — frontend sends start_date/end_date, API reads from_date/to_date
- **loc:** public/admin-item-master.html:1745-1746 (loadPriceHistory) vs routes/item-master.js:106-112 (priceHistoryQuerySchema) + 625 (handler reads from_date/to_date)
- **impact:** The Start date / End date inputs in Price History do nothing — results are never date-filtered. Silent: no error, just ignored, so an admin filtering by date gets the full unfiltered set and may trust wrong data.
- **fix:** Send from_date/to_date (and add to schema) OR rename schema+handler params to start_date/end_date. Choose one naming and use it both sides.

### P1-7 [dead-flow/product-decision] Entire AI command bar / KAI bulk-edit subsystem is unreachable — markup removed but ~500 lines of JS + CSS remain
- **loc:** admin-zoho-items-edit.html:1783 runAiCommand() (also setAiCommand:1232, tryDeterministicBulkUpdate:1583, tryDescriptionFromName:1415, applyBulkUpdate:1736, applyDescFromName:1533); CSS refs at :96-98
- **impact:** The KAI natural-language bulk-edit feature (incl. the deterministic 'Update [brand] category to X where name contains Y' parser and 'Description from name' generator) advertised by the surrounding CSS/JS cannot be used at all — there is no input box or Apply button rendered. If anyone re-adds a trig
- **fix:** Decide intent: (a) if the AI command bar is wanted, re-add the markup (a div#aiCommandBar containing input#aiCommandInput, button#aiApplyBtn onclick="runAiCommand()" with spinner#aiSpinner/icon#aiIcon, and span#aiScopeLabel) above the table; or (b) if removed deliberately, delete runAiCommand/setAiCommand/compactItemsForAI/tryDeterministicBulkUpdate/tryDescriptionFromName/showBulkUpdatePreview/applyBulkUpdate/showDescFromNamePreview/applyDescFromName/undoAiChanges and the #aiCommandBar/#aiCommandInput/#aiApplyBtn CSS, plus the now-orphaned aiResultBanner + 'Undo AI' button.

### P1-8 [error-handling/additive-safe] Zoho-first 'Push updated DPL' button stays permanently disabled after a failed push
- **loc:** public/admin-dpl.html:2168-2190 (pushZohoFirstChanged)
- **impact:** If the Zoho push fails (network error, 4xx/5xx, SKU conflict), the '🚀 Push updated DPL' button is left disabled with the user's selections intact. The user cannot retry the push until they toggle a checkbox (which incidentally calls zfRefreshPushBtn). Looks like a frozen UI after a transient failur
- **fix:** Re-enable in finally like the sibling pushCatalogToZoho() does: change `finally { sp.classList.add('hidden'); }` to `finally { btn.disabled = false; sp.classList.add('hidden'); }` (zfRefreshPushBtn will still correctly re-disable it when 0 selected on the next render).

### P1-9 [xss/additive-safe] esc() does not escape double-quotes — attribute injection in title= for Zoho item name
- **loc:** public/admin-dpl-match.html:302 (renderTable) + esc() at :131
- **impact:** esc() escapes <, > and & (via textContent→innerHTML) but does NOT escape the double-quote character. zoho_item_name is synced from external Zoho Books data. An item name containing a double-quote breaks out of the title="..." attribute and lets an attacker inject additional HTML attributes (e.g. val
- **fix:** Use a quote-safe escaper for attribute context. Either change esc() to also replace " with &quot; and ' with &#39; (e.g. return d.innerHTML.replace(/"/g,'&quot;')), or wrap attribute values explicitly: title="${esc(item.zoho_item_name||'').replace(/"/g,'&quot;')}". Same pattern applies anywhere esc() output lands inside a double-quoted attribute.

### P1-10 [xss/additive-safe] Brand <option value> built with quote-unsafe esc() — attribute injection
- **loc:** public/admin-dpl-match.html:219 (populateBrandFilter)
- **impact:** Same root cause as the title= finding: esc() leaves " intact. zoho_brand comes from synced Zoho data. A brand string containing a double-quote breaks the option value attribute and can inject attributes into the <option> tag. The current WHERE clause limits brands to BIRLA OPUS / BERGER PAINTS, but 
- **fix:** Quote-escape inside attributes (see esc() fix above), or set option.value via DOM: const o=document.createElement('option'); o.value=b; o.textContent=b; sel.appendChild(o);

### P1-11 [xss/additive-safe] Review panel renders Zoho item name, SKU, notes and photo_url unescaped into innerHTML
- **loc:** public/admin-stock-check.html:1279-1287 (openReview, d.items.map)
- **impact:** Stored-XSS surface in the admin review panel. item_name/sku originate from Zoho item catalog; notes/photo_url originate from staff submissions (free text + uploaded path). A staff member can put '<img src=x onerror=...>' (or a quote-breaking string in photo_url that escapes the onclick="showPhoto('.
- **fix:** Escape all four with the existing escDiscHtml() helper before interpolation: `escDiscHtml(item.item_name)`, `escDiscHtml(item.item_sku || '')`, `escDiscHtml(item.notes || '-')`, and for the photo use `escDiscHtml(item.photo_url)` in the src AND pass it to showPhoto via data-attribute / JSON.stringify-encoded arg rather than a single-quote-delimited onclick string.

### P1-12 [xss/additive-safe] Review list, history, dashboard, suggestions and reconcile-branch-mirror interpolate server strings without escaping
- **loc:** public/admin-stock-check.html:1192-1203 (loadReviewList), 1475 (loadDashboard b.branch_name), 1505-1506 (loadSuggestions item_name/sku), 1553-1561 (loadHistory branch_name/staff_name/location_name/created_by_name), 564-566 (initReconcileAdmin option mirror)
- **impact:** Same stored-XSS class as the review panel — branch/staff/Zoho-item names flow straight into innerHTML across 5 render functions. Inconsistent escaping (escDiscHtml exists but is only used in one of six tables) means any name containing markup executes in the admin page.
- **fix:** Run every server-sourced string (branch_name, staff_name, location_name, created_by_name, item_name, sku, branch option text) through escDiscHtml() before template interpolation, matching what loadDiscrepancies already does.

### P1-13 [xss/needs-test] Product search dropdown builds onclick from un-sanitized name/SKU and renders name unescaped
- **loc:** public/admin-stock-check.html:770-773 (searchProducts)
- **impact:** An item name with a double quote or HTML closes the onclick attribute or injects an element into the admin's autocomplete dropdown. Source is the Zoho item catalog. The single-quote-only sanitization is insufficient against " and < / >.
- **fix:** Escape item_name/sku with escDiscHtml() for the visible text, and pass id/name/sku to addProduct via a data-* attribute + event delegation (or JSON-encode the arguments) instead of hand-building a quoted onclick string.

### P1-14 [error-handling/additive-safe] init() and several fetches have no try/catch — a failed branch/inventory/dashboard load throws and leaves 'Loading...' forever
- **loc:** public/admin-stock-check.html:685-715 (init), 720-750 (loadBranchData), 1169-1208 (loadReviewList), 1452-1484 (loadDashboard), 1486-1513 (loadSuggestions)
- **impact:** On any backend 500 or network blip: branch dropdowns never populate (whole Assign tab unusable), Dashboard 'By Branch' stays 'Loading...' indefinitely (loadDashboard returns early on !success), and review list rejects with an uncaught promise. No user-visible error state. Only loadReconSummary/loadD
- **fix:** Add res.ok handling in apiFetch (throw on non-2xx) and wrap each loader in try/catch that renders an inline error + a Retry control, mirroring loadReconSummary's catch which shows 'Failed to load'. For loadDashboard's `if (!res.success) return;` render an explicit error instead of silently returning.

### P1-15 [correctness/needs-test] Item detail "Stock by Location" table never renders (array vs object mismatch)
- **loc:** public/admin-zoho-stock.html:872 (renderDetailContent) + :612 (loadItemDetail)
- **impact:** The whole point of expanding a row (seeing on-hand/available/committed stock per location) is broken. Every expanded item shows "No location breakdown available." The detail panel's primary feature silently fails for all items.
- **fix:** Treat the returned value as the array directly: `const locationStock = Array.isArray(itemDetail) ? itemDetail : (itemDetail && (itemDetail.warehouses || itemDetail.locations || itemDetail.location_stock));`. Backend rows already expose `zoho_location_name`, `stock_on_hand`, `available_stock`, `committed_stock`, which the loc.* fallbacks already cover.

### P1-16 [race/needs-test] Single-branch transfer ignores the in-progress lock → concurrent/duplicate Zoho inventory adjustments
- **loc:** public/admin-stock-migration.html:402-442 (transferBranch)
- **impact:** A user can click multiple branch "Transfer" buttons (or the same one twice before the await resolves) and fire overlapping POST /api/zoho/migration/transfer calls. Each call creates real Zoho inventory adjustments (increase + decrease), so double-clicking double-transfers stock — a money/inventory-c
- **fix:** Set the lock for single transfers too: at the top of transferBranch (after the guard) add `transferInProgress = true;` and wrap the body in try/finally that does `transferInProgress = false;` in the finally. The per-button `btn.disabled = true` at :409 only blocks that one button, not other branches.

### P1-17 [xss/needs-test] Item names break onclick handlers / allow JS injection (escapeHtml does not escape single quotes)
- **loc:** admin-zoho-reorder.html:1844 selectItem dropdown render; also :1212/1215 (renderAlerts PO+Snooze), :1844 (searchItems), :3667 (loadSnoozedItems unsnooze) — every onclick="fn('...')" built with escapeHtml
- **impact:** Any Zoho/server item name containing a single quote breaks the onclick (function call malformed → clicking the item does nothing / throws SyntaxError). A crafted name (item names are editable in Zoho/admin) can inject arbitrary JS executed on click in an admin session. Confirmed exploitable in selec
- **fix:** Add single-quote escaping to escapeHtml for attribute contexts, or better, attach handlers via addEventListener with dataset values instead of inlining names into onclick. Minimal: replace inline onclick="selectItem('id','name')" with a data-id/data-name attribute + a delegated click listener that reads dataset (dataset is auto-decoded and safe). For the numeric-only onclicks (vendor_id, alert id) it is safe.

### P1-18 [dead-flow/additive-safe] Painter offer 'multiplier' badge/label is always blank — code reads offer.bonus_multiplier but the field is multiplier_value
- **loc:** public/painter-catalog.html:310-311 (getOfferBadgeHtml), :579 (renderOfferBanners), :669 (renderDetailPanel)
- **impact:** The backend (routes/painters.js:2004, 2122, 2146) returns offers with `multiplier_value` (the actual DB column, migrate-painter-app.js:70), and explicitly parses it as `multiplier_value`. There is no `bonus_multiplier` field anywhere. So for every 'multiplier' type offer (the DEFAULT offer_type), th
- **fix:** Replace every `offer.bonus_multiplier` / `o.bonus_multiplier` / `bestOffer.bonus_multiplier` with `*.multiplier_value` (e.g. line 310-311: `if (offer.offer_type === 'multiplier' && offer.multiplier_value) return ...${offer.multiplier_value}x...`). Same at 579 and 669.

### P1-19 [dead-flow/needs-test] Painter detail variant rows ('Available Sizes') do nothing — pass undefined item_id and use a query param the estimate page ignores
- **loc:** public/painter-catalog.html:752 (variant row onclick) + :814-817 (createEstimateWith)
- **impact:** Two compounding defects: (1) the detail endpoint (routes/painters.js:2073-2074) returns each variant with field `id` (`id: v.item_id`), NOT `item_id`, so `v.item_id` is `undefined` → URL becomes `...?product=undefined`. (2) painter-estimate-create.html only reads `?product_id=` (line 560 `urlParams.
- **fix:** Use the product id and the param the estimate page understands: change the row to `onclick="createEstimateWith(${p.product_id})"` (or pass v.pack_size_id and add a handler), and change createEstimateWith to navigate to `/painter-estimate-create.html?product_id=${encodeURIComponent(productId)}`. If per-variant preselect is desired, add a `?pack_size_id=` reader in painter-estimate-create.html.

### P1-20 [security/needs-test] Command injection / RCE via NotebookLM endpoint (notebook_id unescaped, query only escapes double-quotes)
- **loc:** routes/item-master.js:588-616 (POST /dpl-notebooklm) + schema 101-104
- **impact:** Any authenticated staff user (only `requireAuth`, no admin/permission gate) can run arbitrary shell commands on the production server. Remote code execution.
- **fix:** Do not use `exec` with string interpolation. Use `execFile('notebooklm', ['use', notebook_id])` and `execFile('notebooklm', ['ask', query])` so arguments are passed as an argv array (no shell). Additionally gate the endpoint behind `requirePermission('system','ai')` or admin-only, and tighten the schema (e.g. notebook_id `regex(/^[A-Za-z0-9_-]+$/)`).

### P1-21 [correctness/needs-test] POST /naming-rules omits NOT NULL `category` column → INSERT fails under strict SQL mode
- **loc:** routes/item-master.js:359-373 (POST /naming-rules); table def migrations/migrate-item-master.js:8-21
- **impact:** Creating a naming rule errors with "Field 'category' doesn't have a default value" → the Naming Rules create feature is unusable on a strict-mode DB (the route returns 500). namingRuleSchema also has no `category` field, so even the validated body lacks it.
- **fix:** Add `category` to the schema + INSERT (derive from CATEGORY_CODES[category_code] if you want it auto-filled): `const category = CATEGORY_CODES[category_code] || category_code; INSERT INTO item_naming_rules (brand, category, product_name, product_short, category_code) VALUES (?,?,?,?,?)`. Or make the column NULL-able via additive migration.

### P1-22 [money/needs-test] Sales-price formula divergence: route uses ceil(dpl*1.298), parser uses ceil(dpl*1.18*1.10) — ₹1 mismatch on ~21 DPL values
- **loc:** routes/item-master.js:45-47 (calculateSalesPrice) vs services/price-list-parser.js:1007 (computeProposedFields)
- **impact:** The selling price an admin previews in the DPL match panel can be ₹1 higher than the price actually persisted/Zoho-synced by dpl-apply, and checkItemHealth (sales_price_mismatch) will mis-flag items priced by the parser formula. Inconsistent canonical pricing on a §6 money path.
- **fix:** Use one constant everywhere. Replace calculateSalesPrice with `Math.ceil(dpl * 1.18 * 1.10)` (the documented §6 formula) or import a single shared helper, so the preview and the apply step agree. Add a characterization test before changing (§6).

### P1-23 [race/needs-test] dpl-apply: price-history INSERT and item UPDATE not transactional, and no idempotency on a financial POST
- **loc:** routes/item-master.js:532-581 (POST /dpl-apply)
- **impact:** If the process dies between the history INSERT and the UPDATE (or vice-versa across items), prices and price-history diverge with no rollback. A double-clicked / retried 'Apply' writes duplicate history rows and re-applies prices. Inconsistent audit trail on a money path.
- **fix:** Wrap each item's two writes (or the whole batch) in a transaction via `const conn = await pool.getConnection(); await conn.beginTransaction(); ... await conn.commit();` and wire `idempotent('dpl-apply')` middleware on the route (matching the other 11 financial POSTs) so retries are deduped.

### P1-24 [security/additive-safe] Idempotency middleware runs before auth on /adjust/:id — replayed key returns success without a valid session
- **loc:** routes/stock-check.js:870 + middleware/idempotency.js:32-57
- **impact:** An unauthenticated or under-privileged caller who knows a previously-used Idempotency-Key value (client-supplied opaque string, often a UUID echoed in logs/network traces) gets the cached 2xx success body replayed with no Bearer-token / permission check. It cannot trigger a NEW Zoho push, but it can
- **fix:** Reorder the middleware so the permission gate runs first: `router.post('/adjust/:id', requirePermission('zoho','stock_check'), idempotent('stockcheck.adjust'), handler)`. This is the same ordering bug pattern wherever idempotent() is placed before its auth gate.

### P1-25 [correctness/needs-test] IDOR: non-'staff' assignable roles can read any assignment's detail (system_qty, photos, notes)
- **loc:** routes/stock-check.js:197-229 — GET /assignments/:id, ownership check at line 218
- **impact:** A logged-in 'sales_staff' or 'branch_manager' (who is NOT a full admin and has no zoho.stock_check permission) can fetch ANY assignment by incrementing :id and see another branch's items, system quantities, photo URLs and notes. requireAuth only proves they have a session; the role check exempts eve
- **fix:** Replace the role-specific check with: if the caller is not a full admin AND lacks zoho.stock_check, require assignment.staff_id === req.user.id (and/or assignment.branch_id === req.user.branch_id). e.g. `const isPrivileged = isFullAdmin(req.user.role) || (await hasPerm(req.user, 'zoho','stock_check')); if (!isPrivileged && assignment.staff_id !== req.user.id) return 403;`

### P1-26 [error-handling/needs-test] /self-request inserts NaN difference and unvalidated item_ids — corrupts data and later pushes phantom Zoho adjustments
- **loc:** routes/stock-check.js:746-774 — POST /self-request item loop
- **impact:** If reported_qty is missing/non-numeric, reportedQty and difference become NaN — inserted into numeric columns (errors under STRICT mode, or silently stored as 0). Worse: zoho_item_id is taken verbatim from the request and never validated against zoho_location_stock; an item not in stockMap gets syst
- **fix:** Mirror the /submit guard: `const reportedQty = parseFloat(item.reported_qty); if (isNaN(reportedQty)) continue;` and skip items whose zoho_item_id is not present in stockMap (`if (!stockMap[item.zoho_item_id]) continue;`). Optionally validate the item belongs to the branch's location before insert.

### P1-27 [error-handling/needs-test] 9205 retry-minus-one matches Zoho error by raw item_name — wrong/partial-name match silently drops the wrong line or loops
- **loc:** routes/stock-check.js:990-1000 — adjust handler insufficient-stock retry
- **impact:** Identifying the failing line by exact item_name string equality is fragile: (1) if Zoho truncates/normalizes the name, or two items share a name, find() returns undefined or the wrong row — when undefined, the `if (itemMatch)` branch is taken but `if (failedItem)` is false, so it falls through to th
- **fix:** Prefer Zoho's structured per-line error (item_id) if available rather than regex on the human message; when name match fails, fall back to removing the single line whose adjustment is most likely the culprit (or push each line individually as a last resort) instead of failing all remaining. At minimum log the unmatched name and surface 'could not identify failing item' distinctly from a true insufficient-stock failure.

### P1-28 [security/needs-test] Branch isolation silently disabled — branchScope queries wrong column (manager_id) so managers always see consolidated/all-branch reorder data
- **loc:** middleware/branchScope.js:23-24 (used by routes/zoho.js:3723 GET /reorder/config and routes/zoho.js:4173 GET /reorder/report)
- **impact:** The query throws `Unknown column 'manager_id'`. The catch block in branchScope.js:32-36 swallows the error and sets `req.branchScope = { branchId: null }`, then calls next(). Result: for a branch-manager hitting GET /reorder/config or GET /reorder/report, branch scoping NEVER applies — they receive 
- **fix:** Change the column in branchScope.js:24 from `manager_id` to `manager_user_id` to match the real schema. Also consider not swallowing the DB error to null (fail closed or log loudly) so a future schema drift doesn't silently disable isolation again.

### P1-29 [security/needs-test] Per-line-item location_id bypasses branch-isolation check on inventory adjustments
- **loc:** routes/zoho.js:2261-2287 POST /inventory-adjustments
- **impact:** A non-admin branch manager can pass their own branch as the top-level `location_id` (passing the 403 guard) while setting a DIFFERENT branch's `location_id` on individual line_items, adjusting another branch's stock in Zoho Books. Defeats the D8 branch-isolation control for inventory adjustments.
- **fix:** Validate every distinct location used in line_items (the per-line `li.location_id` as well as the top-level) against the user's branch before building adjustmentData; reject the request if any maps to a different branch. Simplest: for non-admins, ignore/forbid per-line location_id and force all lines to the validated top-level location.

## UI/UX findings (desktop + mobile)

### UX-1 [P1/ui-mobile] Zoho-uncovered view renders blank on mobile (card renderer never reached)
- **loc:** public/admin-dpl.html:4400-4404 (renderAiTable) + dead renderZohoUncoveredCards at :4218
- **fix:** In renderAiTable(), guard the zoho-uncovered branch by layout: on mobile call `cardCont.innerHTML = renderZohoUncoveredCards()` (and clear aiMatchBody) instead of renderZohoUncoveredTable(). E.g. `if (aiViewMode === 'zoho-uncovered') { if (aiIsMobileLayout()) { document.getElementById('aiMatchBody').innerHTML=''; if(cardCont) cardCont.innerHTML = renderZohoUncoveredCards(); } else { if(cardCont) cardCont.innerHTML=''; renderZohoUncoveredTable(); } return; }`

### UX-2 [P1/ui-mobile] Edit slide-panel is fixed 400px wide with no breakpoint — overflows viewport on phones <400px
- **loc:** public/admin-item-master.html:39 (.slide-panel CSS)
- **fix:** Make width responsive: .slide-panel { width: min(400px, 92vw); right: calc(-1 * min(400px, 92vw) - 20px); } or add @media (max-width:480px){ .slide-panel{ width:100vw; right:-100vw; } }. Verify open transform still fully reveals it.

### UX-3 [P1/ui-mobile] Bulk Map tab is unusable below 640px — the mapping input column is hidden by a global table CSS rule, with no mobile card fallback
- **loc:** public/admin-products.html:68-80 (@media max-width:639px global `table` rules) + tab-bulk-map table (240-256)
- **fix:** Scope the responsive table rules to the products list only (e.g. `#productsTable table { ... }` / `.products-table-wrap table`) instead of bare `table`, and either add a dedicated mobile card list for Bulk Map or wrap the bulk-map table in a horizontal scroll container that the global rule doesn't override.

### UX-4 [P2/perf] buildZohoFirstView runs the reverse matcher per unmatched item against all unlinked entries (O(unmatched × unlinked))
- **loc:** services/dpl-catalog.js:651-653 inside buildZohoFirstView() (served by routes/zoho.js:223 GET /items/dpl-catalog/:brand/by-zoho)
- **fix:** Pre-index unlinkedEntries once (e.g. by size_tier, and by canonical_sku upper) outside the map loop and pass the index into proposeDplForZoho so each lookup is near-O(1) within a tier bucket.

### UX-5 [P2/perf] Reorder report rebuilds the full other-branches map once per row (O(rows × stockRows))
- **loc:** services/reorder-report-service.js:177 and :222 inside assembleReport()
- **fix:** buildOtherBranchesMap is keyed only by targetBranchId for the exclusion. Precompute one map of itemId → all branches with stock>0 (without the target-branch exclusion) once, then for each row filter out the row's own branch when reading. Avoids rebuilding/sorting per row.

### UX-6 [P2/perf] Per-item N+1 Zoho API calls in /adjust and per-item UPDATE loops — slow, and amplifies the double-push race window
- **loc:** routes/stock-check.js:923-939 (live fetch loop) and 1018-1053 (two sequential per-item UPDATE loops)
- **fix:** Batch the live-stock fetch (getItemDetails for all item_ids at once, already used by syncLocationStock) instead of per-item getItem; collapse the two UPDATE loops into one and use a CASE/bulk update. This both speeds it up and shortens the unprotected window.

### UX-7 [P2/perf] dpl-apply runs per-item sequential queries (2 round-trips × up to 500 items) with no batching
- **loc:** routes/item-master.js:537-574 (for loop over items, awaiting 3 queries each: SELECT, INSERT, UPDATE)
- **fix:** Batch-read current prices in one `WHERE zoho_item_id IN (?)`, then use a single transaction and bulk/multi-row INSERT for history; or at least pipeline within a transaction. Pairs with the transaction fix above.

### UX-8 [P2/ui-mobile] Engineer product-detail modal: 7-column price table has no horizontal scroll wrapper — overflows / clips on phones
- **loc:** public/engineer-catalog.html:319-347 (body.innerHTML = ... <table class="ep-table">) inside #dBody (.cat-modal-body)
- **fix:** Wrap the table in a scroll container, e.g. `body.innerHTML = notice + '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">' + '<table class="ep-table" style="min-width:560px">...' + '</table></div>' + footnote`. Or add `@media(max-width:560px){ .cat-modal-body{overflow-x:auto} }`.

### UX-9 [P2/a11y] Dynamically rendered catalog (grid, chips, stock badges) never gets translated — breaks the default Tamil experience
- **loc:** public/painter-catalog.html:401/498/509 (render*) vs only :792 calls applyTranslations; painter-i18n.js:4 default 'ta'
- **fix:** Call `window.painterI18n && window.painterI18n.applyTranslations()` at the end of renderProducts(), renderBrandChips(), and renderCategoryChips() (guarded). Alternatively call it once at the end of fetchCatalog() after all three render. Watch the load order race: fetchCatalog(1,false) at line 835 can run before painter-i18n's DOMContentLoaded loads the JSON, so re-applying after each render is the robust fix.

### UX-10 [P2/perf] Backfill socket progress handlers are registered but never cleaned up if the sync never emits 'done'
- **loc:** admin-zoho-reorder.html:2158-2174 triggerBackfill socket branch
- **fix:** Call window.qcSocket.off(...) for both events before re-registering at the start of the socket branch, or use { once-style } guards.

### UX-11 [P2/ui-desktop] Reset-to-Auto, bulk snooze, and several confirmations use native confirm()/alert() — inconsistent with the qc-ui toast/confirm primitives used elsewhere
- **loc:** admin-zoho-reorder.html:1543 (confirm reset), :2073/2080/2084 (deleteBrand confirm/alert), :2598/2624/2630 (loadSalesAnalysis alert), :2709 (scan confirm), :2868/2920 (push confirm), :3080 (apply-brand confirm)
- **fix:** Replace confirm()/alert() with qcConfirm/qcAlert (already loaded project-wide) for consistency and WebView safety; keep showToast for non-blocking results.

### UX-12 [P2/ui-mobile] Daily Report filter bar packs 9 controls in a single flex-wrap row — cramped/unusable on small screens
- **loc:** admin-zoho-reorder.html:578-623 (<div class="flex gap-3 items-end mb-4 flex-wrap"> with Date, Branch, Period, Min avg, Search(flex-1 min-w-[160px]), Sort, Load, Download PDF, Send WhatsApp, Re-run)
- **fix:** Group filters vs actions into separate responsive blocks (e.g. a grid grid-cols-2 sm:grid-cols-3 for inputs and a flex-wrap row for actions), or collapse actions into a menu on mobile.

### UX-13 [P2/ui-desktop] Active-config toggle in Config table is purely cosmetic until Save is clicked (silent data risk)
- **loc:** admin-zoho-reorder.html:1592-1597 toggleConfigActive + :1520 onclick + :1602 saveConfig
- **fix:** Either persist on toggle (call saveConfig(id) or a lightweight PATCH inside toggleConfigActive), or add a visible "unsaved" state / tooltip on the toggle indicating Save is required.

### UX-14 [P2/ui-desktop] Reorder-check button label reverts to "Check Reorder" but initial/responsive label is "Check"
- **loc:** admin-zoho-reorder.html:180 (initial span text "Check") vs :1411 (finally sets text to 'Check Reorder')
- **fix:** Change line 1411 to text.textContent = 'Check'; to match the initial label (or set both to the same string).

### UX-15 [P2/ui-desktop] Detail panel max-height:600px can clip the location/history content on desktop
- **loc:** public/admin-zoho-stock.html:89-92 (.detail-panel.open) 
- **fix:** Use a larger/auto cap or make the panel scroll: e.g. `.detail-panel.open { max-height: none; }` with the panel content wrapped in a `max-h-[480px] overflow-y-auto` container, or raise max-height and add overflow-y:auto when open.

### UX-16 [P2/ui-desktop] Stat card label says "Pending" but is hard-wired to the branch count, never decrements as transfers complete
- **loc:** public/admin-stock-migration.html:320 (renderSummary) + :388-400 (setBranchStatus)
- **fix:** After each setBranchStatus success/skip in transferBranch/transferAll, decrement and re-render statPending (e.g. recompute from remaining branches still showing a Transfer button), or relabel it "Branches with stock" to match its static meaning.

### UX-17 [P2/ui-desktop] Assign tab has no loading/empty state for branch list and no error if branches fail to load
- **loc:** public/admin-stock-check.html:188-190, 685-695 (init)
- **fix:** Show a transient 'Loading branches…' disabled option and, on failure, an inline error + Retry. Wrap init() branch fetch in try/catch.

### UX-18 [P2/ui-desktop] Photo modal has duplicate/conflicting inline display style (display:none AND display:none via two declarations)
- **loc:** public/admin-stock-check.html:481-483 (#photoModal)
- **fix:** Remove the duplicate trailing `display:none;` in the inline style.

### UX-19 [P2/ui-mobile] Review list and History tables are not wrapped in an overflow-x scroll container — 11-column tables overflow the card on narrow screens
- **loc:** public/admin-stock-check.html:1180-1207 (loadReviewList table) and 1541-1572 (loadHistory table)
- **fix:** Wrap the injected tables in `<div style="overflow-x:auto;">...</div>` (matching the reconcile tables), or apply the .sc-table responsive card pattern.

### UX-20 [P2/ui-mobile] Mobile card CSS targets table[id*="stock"] but the inventory table id is invTable / sc-table — the 639px card layout never applies
- **loc:** public/admin-stock-check.html:99-126 (@media max-width:639px) vs 280 (id="invTable"), 359/412/1181/1266/1471/1501 (class="sc-table")
- **fix:** Either retarget the mobile rules to `.sc-table` / `#invTable`, or remove the dead block and add real responsive treatment (e.g. wrap the review/history tables in a horizontal-scroll container — review and history are NOT inside an overflow-x:auto wrapper unlike reconcile/inventory).

### UX-21 [P2/ui-desktop] 'Available' column header looks like data column but is non-sortable while neighbors are sortable
- **loc:** public/admin-zoho-stock-adjust.html:163-164
- **fix:** Either add a sort option for available_stock to the backend SORT whitelist and mark the header col-sortable, or visually de-emphasize that it is non-sortable (consistent with other static headers).

### UX-22 [P2/ui-desktop] Per-brand summary cards use flex-1 with no wrap/min-width — squeeze on narrow desktop
- **loc:** public/admin-dpl-match.html:85 + renderSummary :181/:198
- **fix:** Add flex-wrap and a min-width to cards: container `flex flex-wrap gap-4`, card style `min-width:180px`. Low effort, future-proofs against more brands.

### UX-23 [P2/ui-mobile] Mobile cards on DPL match page are not actually rendered (display hidden, no responsive show)
- **loc:** public/admin-dpl-match.html:126 + CSS :43-48
- **fix:** Remove the literal `hidden` class from #mobileCards and control visibility purely via the media query (it already sets display:block at <=767px and the element is display:block by default which the desktop side does not hide — add `@media(min-width:768px){.mobile-cards{display:none}}` to mirror the stock-adjust page's cleaner approach).

### UX-24 [P2/ui-desktop] 'Total Decrease' renders as '-0' when there are no decreases
- **loc:** public/admin-zoho-stock-adjust.html:454-455 (updateSummary)
- **fix:** Render sign only when non-zero: `'-' + totalDec` → `(totalDec ? '-'+totalDec : '0')`, similarly for increase.

### UX-25 [P2/ui-desktop] Summary cards mix global (all-location) adjustment totals with single-location 'Items Shown'
- **loc:** public/admin-zoho-stock-adjust.html:446-456 (updateSummary)
- **fix:** Either scope the increase/decrease/adjusted counters to selectedLocationId (filter Object.keys by `k.startsWith(selectedLocationId+':')`), or relabel the cards 'Adjusted (all locations)' to make the cross-location aggregation explicit.

### UX-26 [P2/ui-desktop] Edit modals (#zfEditModal, #catEditModal, #catPickerModal) don't close on backdrop click
- **loc:** public/admin-dpl.html:473 (#zfEditModal), 510 (#catPickerModal), 527 (#catEditModal) vs :458 (#zfAttachModal has backdrop close) and :2865 (zohoPicker backdrop close)
- **fix:** Add `onclick="if(event.target===this)closeZfEdit()"` / `closeCatEdit()` / `closeCatPicker()` to the respective overlay divs (matching #zfAttachModal's pattern) so all modals share one dismissal behavior.

### UX-27 [P2/ui-desktop] No loading state while catalog / Zoho-first / brand-DPL data fetches
- **loc:** public/admin-dpl.html:1280-1317 (loadBrandDplState), 1621-1642 (loadZohoFirst), 2192-2213 (loadCatalog)
- **fix:** Show a lightweight loading indicator before each fetch (e.g. set #catalogEmpty/#zohoFirstEmpty text to 'Loading…' and reveal it, or use qcSkeletonRows) and clear it on success/error. At minimum gate the relevant table body with a 'Loading…' row while the request is in flight.

### UX-28 [P2/ui-desktop] Green (#1B5E3B) push buttons break admin brand palette
- **loc:** public/admin-dpl.html:1038, 3410, 3518-3521, 3704-3707, 4223, 4236 (push-to-Zoho buttons) vs admin theme-color #667eea at :6
- **fix:** Replace the hardcoded #1B5E3B push-button backgrounds with the admin brand indigo (#4f46e5 / #667eea) or the emerald already used elsewhere on this page for push actions (e.g. #059669), matching pushCatalogToZoho's emerald button, so all push CTAs share one palette.

### UX-29 [P2/ui-desktop] Mobile cards iterate full `items` while desktop table honours column filters via getFilteredItems() — divergent visible sets
- **loc:** admin-zoho-items-edit.html:976 renderCards() (items.forEach) vs :853 renderTable() (getFilteredItems())
- **fix:** Have renderCards() iterate getFilteredItems() as well, so both renderers share the same row set: `getFilteredItems().forEach(...)`.

### UX-30 [P2/ui-desktop] Pagination per-page select and jump-to-page input use purple-500 focus ring, off the indigo brand used everywhere else
- **loc:** admin-zoho-items-edit.html:313 (#perPageSelect focus:border-purple-500), :1074 (jump input focus:border-purple-500)
- **fix:** Change both to focus:border-indigo-500 (and add focus:ring-2 focus:ring-indigo-200 to match the form inputs) for visual consistency.

### UX-31 [P2/ui-mobile] Several top-toolbar buttons lack qc-mobile-btn class → ~26px touch targets on phones
- **loc:** admin-zoho-items-edit.html:162 (% Adjust), :208 (Inactive), :214 (Columns), :236 (Sync), :240 (View Items)
- **fix:** Add the `qc-mobile-btn` class to the five buttons at lines 162, 208, 214, 236, 240 (matching the other toolbar buttons).

### UX-32 [P2/ui-desktop] Price Calculator: 'Apply Selected to Price Calculator' from DPL Import never sets the brand dropdown or dpl_version_id, leaving inconsistent state
- **loc:** public/admin-item-master.html:1400-1425 (applyMatchedToPriceCalc) & 1674-1675 (applyPriceChanges uses priceCalcDplVersionId, never set)
- **fix:** In applyMatchedToPriceCalc, set priceCalcDplVersionId from the parsed/match data (and optionally preselect the brand in #priceCalcBrand) so dpl-apply records dpl_version_id. Align with dplApplySchema's version_id key.

### UX-33 [P2/ui-desktop] Health Check uses purple text/border buttons — violates admin brand (purple is reserved; admin accents are indigo #667eea/#764ba2)
- **loc:** public/admin-item-master.html:373 (#btnRecalcSales) & 843 (renderBrandBadge purple option)
- **fix:** Recolor #btnRecalcSales to an indigo/blue accent consistent with the page (e.g. border-indigo-400 text-indigo-600 hover:bg-indigo-50). Optionally drop the purple entry from the brand badge palette. Purely visual.

### UX-34 [P2/ui-mobile] Bulk actions bar overlaps last table rows / pagination on mobile (fixed bottom bar, no body padding)
- **loc:** public/admin-item-master.html:43-44 (.bulk-bar) & 517-527 (#bulkBar) & 156 (#paginationBar)
- **fix:** Add body/container padding-bottom (e.g. when bulkBar.show, add a spacer or pb-24) and let the bar wrap gracefully (flex-wrap gap-2) on small screens; consider stacking the two button groups under the count on <640px.

### UX-35 [P2/ui-mobile] Mobile product card Edit/Delete buttons (and FAB) lack permission gating present on desktop
- **loc:** public/admin-products.html:949-950 (mobile card buttons), 3161 (FAB)
- **fix:** Add data-permission-module="products" data-permission-action="edit"/"delete" to the mobile card buttons and data-permission-action="add" to the FAB, matching the desktop markup so applyPermissions() hides them uniformly.

## Filtered false-positives
- Manual numeric input can store NaN into adjustments, corrupting push payload @ public/admin-zoho-stock-adjust.html:382-389 (onAdjInput) — The claimed impact ("NaN sent as quantity_adjusted:NaN → serialized to null → corrupting a real stock push") is refuted by the actual push code in public/admin-zoho-stock-adjust.html.

The cited evide
