# DPL Catalog — Sub-Plan 2a: Build/Review API endpoints

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Wire `services/dpl-catalog.js` into `routes/zoho.js` with three admin endpoints — build the catalog, read it, and confirm a link — so the upcoming `admin-dpl.html` Catalog UI has its API.

**Architecture:** Thin Express handlers over the already-tested catalog service. Build reads the **raw** `brand_dpl_lists.parsed_rows` (so `normalizeRow` sees the CSV-shape `productCode`/`colourName`/`baseCode`) + active `zoho_items_map`, runs `buildCatalogFromDpl`, persists via `upsertEntries`. `dpl_catalog` migration must be applied on the target DB before these run.

**Tech Stack:** Express (CommonJS), mysql2 pool via `setPool`, `requirePermission('zoho','manage')`, Jest route-registration tests (no supertest).

**Spec:** `docs/superpowers/specs/2026-06-02-dpl-catalog-design.md`

---

## Task 1: Wire service + 3 endpoints + tests

**Files:**
- Modify: `routes/zoho.js` (require + setPool wiring + 3 routes)
- Modify: `server.js` (no change needed — `zohoRoutes.setPool(pool)` already cascades)
- Test: `tests/unit/dpl-catalog-endpoints.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dpl-catalog-endpoints.test.js`:

```javascript
const { router } = require('../../routes/zoho');

describe('dpl-catalog endpoints registered on zoho router', () => {
    const has = (method, path) => router.stack.some(l => l.route && l.route.path === path && l.route.methods[method]);
    test('POST /items/dpl-catalog/:brand/build', () => {
        expect(has('post', '/items/dpl-catalog/:brand/build')).toBe(true);
    });
    test('GET /items/dpl-catalog/:brand', () => {
        expect(has('get', '/items/dpl-catalog/:brand')).toBe(true);
    });
    test('POST /items/dpl-catalog/entry/:id/confirm-link', () => {
        expect(has('post', '/items/dpl-catalog/entry/:id/confirm-link')).toBe(true);
    });
});
```

- [ ] **Step 2: Run, verify it FAILS**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js`
Expected: FAIL — the three routes are not registered.

- [ ] **Step 3: Require the service**

In `routes/zoho.js`, find the line `const brandDplService = require('../services/brand-dpl-service');` (~line 46) and add immediately after it:

```javascript
const dplCatalogService = require('../services/dpl-catalog');
```

- [ ] **Step 4: Wire setPool**

In the `setPool(dbPool)` function (~line 153), find `brandDplService.setPool(dbPool);` and add immediately after it:

```javascript
    dplCatalogService.setPool(dbPool);
```

- [ ] **Step 5: Add the three endpoints**

In `routes/zoho.js`, immediately AFTER the existing `assertSupportedBrand` function (it ends with its closing `}` near line 105), insert:

```javascript
// ========================================
// DPL CATALOG (deterministic item-master mediator) — build / read / confirm-link
// ========================================

// Build (or rebuild) the brand catalog from its saved DPL + the active Zoho items.
router.post('/items/dpl-catalog/:brand/build', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }

        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                    zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
                    zoho_description AS description
             FROM zoho_items_map WHERE zoho_status = 'active'`
        );

        const entries = dplCatalogService.buildCatalogFromDpl(brand, parsedRows, zohoItems);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.upsertEntries(entries, updatedBy);

        const summary = { total: entries.length, confirmed: 0, review: 0, needs_creating: 0 };
        entries.forEach(e => { summary[e.link_status] = (summary[e.link_status] || 0) + 1; });

        res.json({ success: true, data: summary });
    } catch (err) {
        console.error('DPL catalog build error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Read the brand catalog (all entries, grouped client-side for the review UI).
router.get('/items/dpl-catalog/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const entries = await dplCatalogService.getCatalog(brand);
        res.json({ success: true, data: entries });
    } catch (err) {
        console.error('DPL catalog get error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Pin a catalog entry to a specific Zoho item (user-confirmed link).
router.post('/items/dpl-catalog/entry/:id/confirm-link', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const zohoItemId = req.body && req.body.zoho_item_id;
        if (!zohoItemId) return res.status(400).json({ success: false, message: 'zoho_item_id required' });
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.confirmLink(id, String(zohoItemId), updatedBy);
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog confirm-link error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 6: Run, verify PASS**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify module load + no regression**

Run:
```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `zoho OK` and all pass.

- [ ] **Step 8: Commit**

```bash
git add routes/zoho.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "feat(dpl-catalog): build/read/confirm-link API endpoints"
```

---

## Notes
- `dpl_catalog` table must exist on the DB before `build` runs (apply `migrations/migrate-dpl-catalog.js`).
- The build endpoint passes the RAW `parsed_rows` (NOT the `cleanItems` shape that `runBrandDplMatch` builds) so `normalizeRow` sees `productCode`/`colourName`/`baseCode`.
- UI (`admin-dpl.html` Catalog tab) is the next piece (sub-plan 2b).
