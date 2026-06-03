# DPL Catalog — Sub-Plan 3: Apply prices + Push to Zoho

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the DPL Catalog loop — re-key a fresh DPL onto the pinned catalog to compute a price diff (`apply-prices`), then push user-selected confirmed entries to Zoho through the existing `bulk-edit` job path, logging each change to `dpl_price_history`.

**Architecture:** Two new thin endpoints on the zoho router over the already-tested `services/dpl-catalog.js`. `apply-prices` runs the pure `applyDplPrices` diff and persists the new `current_dpl`/`current_rate` locally on matched catalog rows (no Zoho write). `push` reads the user-selected confirmed entries, reads their current Zoho values, builds per-item `changes` (prices always; canonical name/sku/description/category only when they differ), reuses an extracted `createBulkEditJob` helper (the same SKU-uniqueness guards the manual edit path uses), then logs `dpl_price_history`. The `admin-dpl.html` Catalog panel gains an "Apply Prices" button (shows old→new) and per-row push checkboxes + a "Push to Zoho" button.

**Tech Stack:** Express (CommonJS), mysql2 pool via `setPool`, `requirePermission('zoho','manage')`, Jest unit + route-registration tests (no supertest), vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-06-02-dpl-catalog-design.md` (Phase 2).

**User decisions (2026-06-03):**
- Push selection = **per-row checkboxes** (+ a "select all confirmed" affordance). Nothing reaches Zoho without an explicit tick + a confirm dialog.
- Push fields = **prices always (`cf_dpl`,`purchase_rate`,`rate`); name/sku/description/category only when the canonical value differs from the current Zoho value.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | Enrich `applyDplPrices` diff rows with display + canonical fields; add pure `buildPushChanges(entry, zohoCurrent)`; add `updateAppliedPrices(rows, updatedBy)` DB helper | Modify |
| `tests/unit/dpl-catalog.test.js` | Cover the enriched diff, `buildPushChanges` (all branches), `updateAppliedPrices` SQL | Modify |
| `routes/zoho.js` | Extract `createBulkEditJob(items, user)` helper from the existing `/items/bulk-edit` route (behaviour-preserving); add `POST .../apply-prices` + `POST .../push` endpoints with `dpl_price_history` logging | Modify |
| `tests/unit/dpl-catalog-endpoints.test.js` | Assert the two new routes are registered | Modify |
| `public/admin-dpl.html` | "💰 Apply Prices" button + diff render; per-row push checkbox column + "🚀 Push to Zoho" button + confirm | Modify |

**Reused unchanged:** `applyDplPrices` core bucketing logic, `brandDplService.getForMatch`, `zoho_items_map`, the `bulk-edit` SKU guards + background worker, the pricing formula `ceil(DPL×1.18×1.10)`, `dpl_price_history` (written exactly as `routes/item-master.js` `/dpl-apply` does — columns `zoho_item_id, version_id, old_dpl, new_dpl, old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by`, `version_id` NULL).

---

## Task 1: Service — enriched diff, push-changes builder, price-persist helper

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/dpl-catalog.test.js` (after the existing `applyDplPrices` describe, before `dpl-catalog DB layer`):

```javascript
describe('applyDplPrices — enriched diff fields', () => {
    const existing = [
        { id: 1, match_key: 'birlaopus|941001|white|1l', zoho_item_id: 'Z1', current_dpl: 490,
          current_rate: 636, link_status: 'confirmed', product_name: 'One Pure Elegance',
          base_name: 'White', size_tier: '1L', dpl_size_label: '1L',
          canonical_name: 'BIRLA OPUS ONE PURE ELEGANCE WHITE 1L', canonical_sku: 'PE9901',
          canonical_description: 'desc' },
    ];
    const rows = [{ product: 'One Pure Elegance - White', packSize: '1L', dpl: 510, baseCode: '941001' }];

    test('updated rows carry id, zoho_item_id, link_status, old_rate, canonical + display fields', () => {
        const u = catalog.applyDplPrices('birlaopus', rows, existing).updated[0];
        expect(u.id).toBe(1);
        expect(u.zoho_item_id).toBe('Z1');
        expect(u.link_status).toBe('confirmed');
        expect(u.old_rate).toBe(636);
        expect(u.new_rate).toBe(Math.ceil(510 * 1.18 * 1.10));
        expect(u.product_name).toBe('One Pure Elegance');
        expect(u.base_name).toBe('White');
        expect(u.size_tier).toBe('1L');
        expect(u.canonical_sku).toBe('PE9901');
        expect(u.canonical_name).toBe('BIRLA OPUS ONE PURE ELEGANCE WHITE 1L');
    });
});

describe('buildPushChanges', () => {
    const entry = {
        current_dpl: 510, current_rate: 662,
        canonical_name: 'BIRLA OPUS ONE PURE ELEGANCE WHITE 1L', canonical_sku: 'PE9901',
        canonical_description: 'Premium interior emulsion', category: 'Interior Luxury',
    };

    test('always includes prices', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'PE9901', name: entry.canonical_name,
            description: entry.canonical_description, category: 'Interior Luxury', cf_dpl: 490 });
        expect(c.cf_dpl).toBe(510);
        expect(c.purchase_rate).toBe(510);
        expect(c.rate).toBe(662);
    });

    test('adds name/sku/description/category only when they differ', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'OLD', name: 'Old Name',
            description: 'old', category: 'Old Cat', cf_dpl: 490 });
        expect(c.name).toBe('BIRLA OPUS ONE PURE ELEGANCE WHITE 1L');
        expect(c.sku).toBe('PE9901');
        expect(c.description).toBe('Premium interior emulsion');
        expect(c.category).toBe('Interior Luxury');
    });

    test('omits name/sku when identical to current Zoho values', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'PE9901', name: entry.canonical_name,
            description: entry.canonical_description, category: 'Interior Luxury', cf_dpl: 490 });
        expect(c).not.toHaveProperty('name');
        expect(c).not.toHaveProperty('sku');
        expect(c).not.toHaveProperty('description');
        expect(c).not.toHaveProperty('category');
    });

    test('never emits empty canonical values', () => {
        const c = catalog.buildPushChanges({ current_dpl: 510, current_rate: 662,
            canonical_name: '', canonical_sku: null }, { sku: 'X', name: 'Y', cf_dpl: 1 });
        expect(c).not.toHaveProperty('name');
        expect(c).not.toHaveProperty('sku');
    });

    test('returns null when entry has no current_dpl', () => {
        expect(catalog.buildPushChanges({ current_dpl: null }, {})).toBeNull();
    });
});

describe('updateAppliedPrices', () => {
    test('issues one UPDATE per row with new dpl/rate', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.updateAppliedPrices(
            [{ id: 7, new_dpl: 510, new_rate: 662 }], 'admin');
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET/i);
        expect(calls[0].params).toEqual([510, 662, 'admin', 7]);
    });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tests/unit/dpl-catalog.test.js`
Expected: FAIL — `buildPushChanges`/`updateAppliedPrices` undefined; enriched fields missing.

- [ ] **Step 3: Enrich `applyDplPrices`**

In `services/dpl-catalog.js`, inside `applyDplPrices`, replace the `if (existing) { ... updated.push({...}) }` block's `updated.push` call with the enriched payload:

```javascript
        if (existing) {
            seen.add(match_key);
            updated.push({
                id: existing.id, match_key, zoho_item_id: existing.zoho_item_id,
                link_status: existing.link_status,
                product_name: existing.product_name, base_name: existing.base_name,
                size_tier: existing.size_tier, dpl_size_label: existing.dpl_size_label,
                canonical_name: existing.canonical_name, canonical_sku: existing.canonical_sku,
                canonical_description: existing.canonical_description,
                old_dpl: existing.current_dpl != null ? parseFloat(existing.current_dpl) : null,
                old_rate: existing.current_rate != null ? parseFloat(existing.current_rate) : null,
                new_dpl: n.dpl, new_rate,
            });
        } else {
```

(Leave the `else { newNeedsLinking.push(...) }` branch unchanged.)

- [ ] **Step 4: Add `buildPushChanges`**

In `services/dpl-catalog.js`, immediately AFTER the `applyDplPrices` function, add:

```javascript
// Build the per-item `changes` payload for a bulk-edit push from a confirmed
// catalog entry. Prices are always pushed; name/sku/description/category are
// pushed ONLY when the canonical value is non-empty AND differs from the
// current Zoho value (avoids needless writes + SKU-collision churn).
// Returns null when the entry has no DPL to push.
function buildPushChanges(entry, zohoCurrent) {
    const dpl = entry.current_dpl != null ? parseFloat(entry.current_dpl) : null;
    if (!(dpl > 0)) return null;
    const rate = entry.current_rate != null ? parseFloat(entry.current_rate) : Math.ceil(dpl * 1.18 * 1.10);
    const changes = { cf_dpl: dpl, purchase_rate: dpl, rate };
    const z = zohoCurrent || {};
    const diff = (canon, current) => {
        const c = (canon == null ? '' : String(canon)).trim();
        return c && c !== String(current == null ? '' : current).trim();
    };
    if (diff(entry.canonical_name, z.name)) changes.name = String(entry.canonical_name).trim();
    if (diff(entry.canonical_sku, z.sku)) changes.sku = String(entry.canonical_sku).trim();
    if (diff(entry.canonical_description, z.description)) changes.description = String(entry.canonical_description).trim();
    if (diff(entry.category, z.category)) changes.category = String(entry.category).trim();
    return changes;
}
```

- [ ] **Step 5: Add `updateAppliedPrices` DB helper**

In `services/dpl-catalog.js`, immediately AFTER the `confirmLink` function, add:

```javascript
// Persist freshly-applied DPL prices onto matched catalog rows (local only).
async function updateAppliedPrices(rows, updatedBy) {
    for (const r of (rows || [])) {
        await pool.query(
            `UPDATE dpl_catalog SET current_dpl = ?, current_rate = ?, updated_by = ? WHERE id = ?`,
            [r.new_dpl, r.new_rate, updatedBy || null, r.id]
        );
    }
}
```

- [ ] **Step 6: Export the new functions**

In `services/dpl-catalog.js`, update `module.exports` to add `buildPushChanges` and `updateAppliedPrices`:

```javascript
module.exports = {
    setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey,
    dplBaseStem, zohoSkuStem, linkEntryToZoho, buildCatalogFromDpl, applyDplPrices,
    buildPushChanges, upsertEntries, getCatalog, confirmLink, updateAppliedPrices,
};
```

- [ ] **Step 7: Run, verify PASS**

Run: `npx jest tests/unit/dpl-catalog.test.js`
Expected: PASS (all prior + new tests).

- [ ] **Step 8: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): enriched price diff + buildPushChanges + updateAppliedPrices"
```

---

## Task 2: Extract `createBulkEditJob` helper (behaviour-preserving refactor)

The push endpoint must reuse the manual edit path's SKU-uniqueness guards and job creation. Extract them into a module-scoped helper that both the existing route and the new push endpoint call. No behaviour change to `/items/bulk-edit`.

**Files:**
- Modify: `routes/zoho.js` (extract helper, slim the route)
- Test: `tests/unit/dpl-catalog-endpoints.test.js` (registration stays green; no new test here)

- [ ] **Step 1: Read the current route**

Read `routes/zoho.js` lines ~2850-3022 (the `router.post('/items/bulk-edit', ...)` handler) so the extraction is exact.

- [ ] **Step 2: Add the helper above the route**

In `routes/zoho.js`, immediately BEFORE the `/**` JSDoc block that precedes `router.post('/items/bulk-edit'` (~line 2850), insert this helper. Its body is the route body with `req`/`res` removed: validation/guards throw a tagged error; success returns the job summary.

```javascript
// Shared core of the per-item bulk edit: validates, enforces SKU uniqueness
// (batch + local-mirror cross-check), creates the bulk job + job items, and
// optimistically updates the local zoho_items_map (SKU excluded — written only
// after Zoho confirms, in the bulk-job worker). Throws an Error tagged with
// { httpStatus, code, payload } for the caller to translate to a response.
async function createBulkEditJob(items, user) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error('items array is required'), { httpStatus: 400 });
    }
    for (const item of items) {
        if (!item.zoho_item_id || !item.changes || Object.keys(item.changes).length === 0) {
            throw Object.assign(new Error('Each item must have zoho_item_id and non-empty changes'), { httpStatus: 400 });
        }
    }

    // Reject batches that would push the same SKU to multiple distinct Zoho items.
    {
        const skuToItems = new Map();
        for (const it of items) {
            const sku = it.changes && it.changes.sku ? String(it.changes.sku).trim() : '';
            if (!sku) continue;
            const key = sku.toUpperCase();
            if (!skuToItems.has(key)) skuToItems.set(key, []);
            skuToItems.get(key).push({ zoho_item_id: it.zoho_item_id, item_name: it.item_name || '', sku });
        }
        const batchDupes = [];
        for (const [_, list] of skuToItems) { if (list.length > 1) batchDupes.push(list); }
        if (batchDupes.length) {
            throw Object.assign(new Error('Batch contains multiple items being pushed with the same SKU. Zoho enforces SKU uniqueness, so this would fail. Edit the SKUs to make them unique.'),
                { httpStatus: 400, code: 'DUPLICATE_SKUS_IN_BATCH', payload: { duplicates: batchDupes } });
        }
        const skuList = Array.from(skuToItems.keys());
        if (skuList.length) {
            const [held] = await pool.query(
                `SELECT zoho_item_id, zoho_sku, zoho_item_name
                   FROM zoho_items_map
                  WHERE zoho_status = 'active'
                    AND UPPER(zoho_sku) IN (${skuList.map(() => '?').join(',')})`,
                skuList
            );
            const conflicts = [];
            for (const row of held) {
                const rowSku = String(row.zoho_sku || '').toUpperCase();
                const batchEntries = skuToItems.get(rowSku) || [];
                for (const be of batchEntries) {
                    if (be.zoho_item_id !== row.zoho_item_id) {
                        conflicts.push({ batch_item: be, already_held_by: { zoho_item_id: row.zoho_item_id, item_name: row.zoho_item_name } });
                    }
                }
            }
            if (conflicts.length) {
                throw Object.assign(new Error('One or more SKUs in the batch are already held by a different active item in Zoho. Push would fail with "SKU already exists". Edit to use unique SKUs.'),
                    { httpStatus: 400, code: 'SKU_HELD_BY_OTHER_ITEM', payload: { conflicts } });
            }
        }
    }

    const [jobResult] = await pool.query(`
        INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
        VALUES ('item_update', ?, ?, ?, ?)
    `, [
        JSON.stringify({ mode: 'per_item_edit', item_count: items.length }),
        JSON.stringify({ mode: 'per_item' }),
        items.length,
        user.id
    ]);
    const jobId = jobResult.insertId;

    const itemsWithoutName = items.filter(i => !i.item_name);
    const nameLookup = {};
    if (itemsWithoutName.length > 0) {
        const ids = itemsWithoutName.map(i => i.zoho_item_id);
        const [nameRows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name FROM zoho_items_map WHERE zoho_item_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        nameRows.forEach(r => { nameLookup[r.zoho_item_id] = r.zoho_item_name; });
    }

    for (const item of items) {
        const itemName = item.item_name || nameLookup[item.zoho_item_id] || '';
        await pool.query(`
            INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
            VALUES (?, ?, ?, ?)
        `, [jobId, item.zoho_item_id, itemName, JSON.stringify(item.changes)]);
    }

    const FIELD_MAP = {
        name: 'zoho_item_name', /* sku intentionally NOT here — see manual-edit comment */
        rate: 'zoho_rate',
        purchase_rate: 'zoho_purchase_rate', cf_dpl: 'zoho_cf_dpl',
        label_rate: 'zoho_label_rate',
        unit: 'zoho_unit', hsn_or_sac: 'zoho_hsn_or_sac',
        tax_percentage: 'zoho_tax_percentage', brand: 'zoho_brand',
        category_name: 'zoho_category_name', category: 'zoho_category_name',
        manufacturer: 'zoho_manufacturer',
        reorder_level: 'zoho_reorder_level', description: 'zoho_description',
        cf_product_name: 'zoho_cf_product_name', status: 'zoho_status'
    };
    for (const item of items) {
        const sets = [];
        const vals = [];
        for (const [key, val] of Object.entries(item.changes)) {
            const dbCol = FIELD_MAP[key];
            if (dbCol) { sets.push(`${dbCol} = ?`); vals.push(val); }
        }
        if (Object.prototype.hasOwnProperty.call(item.changes, 'cf_dpl')) {
            sets.push('dpl_updated_at = NOW()');
        }
        if (sets.length > 0) {
            vals.push(item.zoho_item_id);
            await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        }
        if (Object.prototype.hasOwnProperty.call(item.changes, 'rate')) {
            await pool.query('UPDATE pack_sizes SET base_price = ? WHERE zoho_item_id = ? AND is_active = 1',
                [item.changes.rate, item.zoho_item_id]);
        }
    }

    return { job_id: jobId, total_items: items.length };
}
```

- [ ] **Step 3: Slim the existing route to call the helper**

In `routes/zoho.js`, replace the ENTIRE body of `router.post('/items/bulk-edit', requirePermission('zoho', 'manage'), async (req, res) => { ... })` (the try/catch from `const { items } = req.body;` through the closing of the handler) with:

```javascript
router.post('/items/bulk-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const result = await createBulkEditJob(req.body.items, req.user);
        res.json({ success: true, data: result, message: `Bulk edit job created with ${result.total_items} items` });
    } catch (error) {
        const status = error.httpStatus || 500;
        res.status(status).json(Object.assign({ success: false, message: error.message }, error.code ? { code: error.code } : {}, error.payload || {}));
    }
});
```

- [ ] **Step 4: Verify no regression**

Run:
```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `zoho OK` and the existing registration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/zoho.js
git commit -m "refactor(zoho): extract createBulkEditJob helper (behaviour-preserving)"
```

---

## Task 3: Endpoints — apply-prices + push (+ price-history logging)

**Files:**
- Modify: `routes/zoho.js` (two routes after the existing `confirm-link` route, ~line 171)
- Test: `tests/unit/dpl-catalog-endpoints.test.js`

- [ ] **Step 1: Add failing registration tests**

In `tests/unit/dpl-catalog-endpoints.test.js`, add inside the existing `describe`:

```javascript
    test('POST /items/dpl-catalog/:brand/apply-prices', () => {
        expect(has('post', '/items/dpl-catalog/:brand/apply-prices')).toBe(true);
    });
    test('POST /items/dpl-catalog/:brand/push', () => {
        expect(has('post', '/items/dpl-catalog/:brand/push')).toBe(true);
    });
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js`
Expected: FAIL — the two new routes are not registered.

- [ ] **Step 3: Add the two endpoints**

In `routes/zoho.js`, immediately AFTER the existing `confirm-link` route's closing `});` (~line 171), insert:

```javascript
// Re-key the latest saved DPL onto the pinned catalog → price diff. Persists the
// new current_dpl/current_rate locally (no Zoho write). Returns three buckets.
router.post('/items/dpl-catalog/:brand/apply-prices', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }
        const existing = await dplCatalogService.getCatalog(brand);
        if (!existing.length) {
            return res.status(409).json({ success: false, message: 'Catalog is empty. Build the catalog first.' });
        }

        const diff = dplCatalogService.applyDplPrices(brand, parsedRows, existing);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.updateAppliedPrices(diff.updated, updatedBy);

        res.json({ success: true, data: {
            updated: diff.updated,
            new_needs_linking: diff.newNeedsLinking,
            no_dpl_this_time: diff.noDplThisTime.map(e => ({
                match_key: e.match_key, product_name: e.product_name,
                base_name: e.base_name, size_tier: e.size_tier,
            })),
            summary: { updated: diff.updated.length, new: diff.newNeedsLinking.length, untouched: diff.noDplThisTime.length },
        } });
    } catch (err) {
        console.error('DPL catalog apply-prices error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Push selected confirmed catalog entries to Zoho via the bulk-edit job path.
// Body: { ids: [catalogEntryId, ...] }. Only confirmed entries with a zoho_item_id
// and a current_dpl are pushed; the rest are reported as skipped.
router.post('/items/dpl-catalog/:brand/push', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
        if (!ids.length) return res.status(400).json({ success: false, message: 'ids array required' });

        const all = await dplCatalogService.getCatalog(brand);
        const byId = new Map(all.map(e => [e.id, e]));
        const chosen = ids.map(id => byId.get(id)).filter(Boolean);

        const pushable = chosen.filter(e => e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null);
        const skipped = chosen.filter(e => !(e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null))
            .map(e => ({ id: e.id, reason: !e.zoho_item_id ? 'not linked' : e.link_status !== 'confirmed' ? 'not confirmed' : 'no DPL price' }));
        if (!pushable.length) {
            return res.status(400).json({ success: false, message: 'No pushable confirmed entries with a DPL price in the selection.', skipped });
        }

        // Current Zoho values for diffing + price-history old values.
        const zids = [...new Set(pushable.map(e => String(e.zoho_item_id)))];
        const [zrows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_description AS description,
                    zoho_category_name AS category, zoho_cf_dpl AS cf_dpl, zoho_purchase_rate AS purchase_rate,
                    zoho_rate AS rate
             FROM zoho_items_map WHERE zoho_item_id IN (${zids.map(() => '?').join(',')})`,
            zids
        );
        const zById = new Map(zrows.map(z => [String(z.zoho_item_id), z]));

        const items = [];
        for (const e of pushable) {
            const zc = zById.get(String(e.zoho_item_id)) || {};
            const changes = dplCatalogService.buildPushChanges(e, zc);
            if (!changes) continue;
            items.push({ zoho_item_id: e.zoho_item_id, item_name: zc.name || e.canonical_name || '', changes, _entry: e, _zc: zc });
        }
        if (!items.length) return res.status(400).json({ success: false, message: 'Nothing to push after diffing.', skipped });

        const jobItems = items.map(({ _entry, _zc, ...keep }) => keep);
        const result = await createBulkEditJob(jobItems, req.user);

        // Log price history (best-effort; mirrors routes/item-master.js /dpl-apply).
        for (const it of items) {
            try {
                await pool.query(
                    `INSERT INTO dpl_price_history (zoho_item_id, version_id, old_dpl, new_dpl, old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        it.zoho_item_id, null,
                        it._zc.cf_dpl || 0, it.changes.cf_dpl,
                        it._zc.purchase_rate || 0, it.changes.purchase_rate,
                        it._zc.rate || 0, it.changes.rate,
                        req.user ? req.user.id : null,
                    ]
                );
            } catch (histErr) {
                console.error('DPL catalog push: price-history log failed (non-fatal):', histErr.message);
            }
        }

        res.json({ success: true, data: { job_id: result.job_id, pushed: result.total_items, skipped } });
    } catch (err) {
        const status = err.httpStatus || 500;
        console.error('DPL catalog push error:', err);
        res.status(status).json(Object.assign({ success: false, message: err.message }, err.code ? { code: err.code } : {}, err.payload || {}));
    }
});
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify module load + full catalog suite**

Run:
```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `zoho OK` and all pass.

- [ ] **Step 6: Commit**

```bash
git add routes/zoho.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "feat(dpl-catalog): apply-prices diff + push-to-Zoho endpoints with price-history"
```

---

## Task 4: UI — Apply Prices button + per-row push checkboxes + Push to Zoho

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the Apply Prices button**

In `public/admin-dpl.html`, in the saved-DPL action row, immediately AFTER the `buildCatalog()` button's closing `</button>` (~line 282), add:

```html
                            <button onclick="applyCatalogPrices()" id="applyPricesBtn" class="px-4 py-2 border border-amber-300 bg-white hover:bg-amber-50 text-amber-700 rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50">
                                <svg id="applyPricesSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                💰 Apply Prices
                            </button>
```

- [ ] **Step 2: Add the Push button + select-all to the catalog panel header**

In `public/admin-dpl.html`, inside `#catalogPanel`'s header `<div class="flex gap-1">` filter row (~line 325-330), AFTER the `catFilterConfirmed` button's `</button>`, add a push control group. Replace the closing `</div>` of that `flex gap-1` block so it becomes:

```html
                        <button onclick="setCatalogFilter('confirmed')" id="catFilterConfirmed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Confirmed</button>
                        <span class="mx-1 w-px bg-gray-200"></span>
                        <button onclick="toggleSelectAllConfirmed()" id="catSelectAllBtn" class="px-2 py-1 rounded text-[11px] font-semibold border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50">☑ Select confirmed</button>
                        <button onclick="pushCatalogToZoho()" id="pushZohoBtn" class="px-2 py-1 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 flex items-center gap-1" disabled>
                            <svg id="pushZohoSpinner" class="hidden w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            🚀 Push <span id="pushCount">0</span>
                        </button>
                    </div>
```

- [ ] **Step 3: Add a checkbox column header**

In `public/admin-dpl.html`, in the catalog `<thead>` row (~line 335), add a select header as the FIRST `<th>`:

```html
                                <th class="px-2 py-2 text-center"><input type="checkbox" id="catHeadCheck" onclick="toggleHeadCheck(this)" aria-label="Select all visible confirmed"></th>
```

- [ ] **Step 4: Render a checkbox cell + old→new price in each row**

In `public/admin-dpl.html`, in `renderCatalog()`, replace the row template `return '<tr class="border-t">' + ... ` (the block that builds each `<tr>`) with one that prepends a checkbox cell (only enabled for confirmed+linked entries) and shows the applied new rate when present:

```javascript
            var canPush = (e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null);
            var checkbox = canPush
                ? '<input type="checkbox" class="cat-push-check" data-id="' + e.id + '" ' + (catPushSelected[e.id] ? 'checked' : '') + ' onclick="onCatCheck(' + e.id + ', this.checked)">'
                : '';
            var priceCell = (e.current_dpl != null ? '₹' + e.current_dpl : '-') +
                (e.current_rate != null ? '<div class="text-[10px] text-gray-400">→ ₹' + e.current_rate + '</div>' : '');
            return '<tr class="border-t">' +
                '<td class="px-2 py-1.5 text-center">' + checkbox + '</td>' +
                '<td class="px-2 py-1.5"><div class="font-semibold text-gray-800">' + esc(e.product_name || '') + '</div><div class="text-gray-500">' + esc(e.base_name || '') + '</div></td>' +
                '<td class="px-2 py-1.5">' + esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' <span class="text-gray-400">(' + esc(e.dpl_size_label) + ')</span>' : '') + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + priceCell + '</td>' +
                '<td class="px-2 py-1.5 font-mono">' + esc(e.canonical_sku || '-') + '</td>' +
                '<td class="px-2 py-1.5">' + linked + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + statusBadge + '</td>' +
                '<td class="px-2 py-1.5 text-center whitespace-nowrap">' + action + '</td>' +
                '</tr>';
```

- [ ] **Step 5: Add the push-selection state + handlers**

In `public/admin-dpl.html`, immediately AFTER the `var catZohoNameCache = {};` line (~line 1230), add:

```javascript
    var catPushSelected = {}; // { entryId: true }

    function refreshPushButton() {
        var ids = Object.keys(catPushSelected).filter(function(k){ return catPushSelected[k]; });
        document.getElementById('pushCount').textContent = ids.length;
        document.getElementById('pushZohoBtn').disabled = ids.length === 0;
    }
    function onCatCheck(id, checked) {
        if (checked) catPushSelected[id] = true; else delete catPushSelected[id];
        refreshPushButton();
    }
    function toggleHeadCheck(el) {
        document.querySelectorAll('.cat-push-check').forEach(function(cb){
            cb.checked = el.checked;
            onCatCheck(parseInt(cb.getAttribute('data-id'), 10), el.checked);
        });
    }
    function toggleSelectAllConfirmed() {
        var anyUnselected = catalogEntries.some(function(e){
            return e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && !catPushSelected[e.id];
        });
        catalogEntries.forEach(function(e){
            if (e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null) {
                if (anyUnselected) catPushSelected[e.id] = true; else delete catPushSelected[e.id];
            }
        });
        renderCatalog();
        refreshPushButton();
    }

    async function applyCatalogPrices() {
        var brand = currentBrandDpl || DEFAULT_BRAND;
        var btn = document.getElementById('applyPricesBtn');
        var sp = document.getElementById('applyPricesSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand) + '/apply-prices', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            var s = body.data.summary;
            showToast('Prices applied: ' + s.updated + ' updated, ' + s.new + ' new (need linking), ' + s.untouched + ' untouched', 'success');
            await loadCatalog();
        } catch (err) {
            showToast('Apply prices error: ' + err.message, 'error');
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }

    async function pushCatalogToZoho() {
        var brand = currentBrandDpl || DEFAULT_BRAND;
        var ids = Object.keys(catPushSelected).filter(function(k){ return catPushSelected[k]; }).map(Number);
        if (!ids.length) return;
        if (!confirm('Push ' + ids.length + ' confirmed item(s) to Zoho? This updates DPL, purchase rate, selling rate, and canonical name/SKU where they differ.')) return;
        var btn = document.getElementById('pushZohoBtn');
        var sp = document.getElementById('pushZohoSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand) + '/push', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            var skipped = (body.data.skipped && body.data.skipped.length) ? (', ' + body.data.skipped.length + ' skipped') : '';
            showToast('Push job #' + body.data.job_id + ' created: ' + body.data.pushed + ' item(s) queued' + skipped, 'success');
            catPushSelected = {};
            refreshPushButton();
        } catch (err) {
            showToast('Push error: ' + err.message, 'error');
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }
```

- [ ] **Step 6: Reset selection + refresh button on catalog reload**

In `public/admin-dpl.html`, inside `loadCatalog()`, AFTER `catalogEntries = body.data || [];` add:

```javascript
            catPushSelected = {};
```

And at the END of `renderCatalog()` (after `tbody.innerHTML = ...`), add:

```javascript
        refreshPushButton();
```

- [ ] **Step 7: Manual smoke (browser)**

Verify in `admin-dpl.html` for Birla Opus, with a built catalog:
1. Click **💰 Apply Prices** → toast shows updated/new/untouched counts; the catalog table now shows `→ ₹rate` under DPL.
2. Confirmed+linked rows show a checkbox; review/needs-creating rows do not.
3. **☑ Select confirmed** ticks all confirmed rows; **🚀 Push N** enables and shows the count.
4. Click **🚀 Push** → confirm dialog → toast with a job number; selection clears.
5. Open the Bulk Jobs view → the new `item_update` job is present with the pushed items.

- [ ] **Step 8: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog): Apply Prices + per-row Push-to-Zoho UI"
```

---

## Self-Review notes (spec coverage)

- **Phase 2 step 1-2 (re-key + recompute current_dpl/current_rate):** Task 1 enriches `applyDplPrices`; Task 3 `apply-prices` persists via `updateAppliedPrices`. ✓
- **Phase 2 step 2 buckets (found / new-needs-linking / no-DPL-this-time):** returned by `apply-prices` as `updated`/`new_needs_linking`/`no_dpl_this_time`. ✓
- **Phase 2 step 3 (diff view old→new):** `updated` rows carry `old_dpl/old_rate/new_dpl/new_rate`; UI renders `→ ₹rate`. ✓
- **Phase 2 step 4 (push to existing bulk-edit; name/sku only when differing; dpl_price_history):** Task 2 extracts the bulk-edit core; Task 3 `push` builds diff-aware changes via `buildPushChanges` and logs history. ✓
- **User caution (no risky bulk-confirm):** per-row checkboxes + explicit confirm dialog; only `confirmed` entries are ever pushable. ✓
- **Reused SKU-uniqueness guards:** push goes through `createBulkEditJob` (same guards as the manual path). ✓

## Out of scope (carried from spec)

- Auto-creating `needs_creating` items in Zoho (flag only).
- Brands other than Birla Opus.
- A `dpl_versions` row per catalog push (`version_id` logged as NULL — the catalog is the version of record).
