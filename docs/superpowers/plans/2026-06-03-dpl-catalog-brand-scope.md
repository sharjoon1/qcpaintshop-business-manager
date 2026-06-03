# DPL Catalog — brand-scope candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Build Catalog only consider the catalog brand's own Zoho items, so Birla DPL rows stop matching other brands' items (e.g. Astral "GEMCL" colorants); also scope the manual re-pick to the brand.

**Architecture:** Add a tolerant per-brand SQL scope (`zoho_brand` OR item name carries the brand) to the build endpoint's candidate query in `routes/zoho.js`; append a `brand=BIRLA` filter to the catalog picker fetch in `admin-dpl.html`. No service/linker/migration change — the linker just receives correctly-scoped candidates. Post-deploy: rebuild the catalog (controller-run).

**Tech Stack:** Express CommonJS + mysql2, Jest (unit + route registration), vanilla JS UI.

**Spec:** `docs/superpowers/specs/2026-06-03-dpl-catalog-brand-scope-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `routes/zoho.js` | `CATALOG_ZOHO_SCOPE` map + `catalogZohoScopeSql(brand)`; apply in build query; export helper | Modify |
| `tests/unit/dpl-catalog-endpoints.test.js` | unit test for `catalogZohoScopeSql` | Modify |
| `public/admin-dpl.html` | catalog picker fetch gains `&brand=BIRLA` | Modify |

**Reused unchanged:** `buildCatalogFromDpl`, the linker, `upsertEntries`, all other endpoints.

---

## Task 1: Brand-scope the build candidate query

**Files:** Modify `routes/zoho.js`; Modify `tests/unit/dpl-catalog-endpoints.test.js`.

- [ ] **Step 1: Write failing test** — in `tests/unit/dpl-catalog-endpoints.test.js`, add (the file already does `const { router } = require('../../routes/zoho');` — extend the require to also pull the helper):

```javascript
const { catalogZohoScopeSql } = require('../../routes/zoho');

describe('catalogZohoScopeSql', () => {
    test('birlaopus → tolerant BIRLA scope (brand OR name)', () => {
        const s = catalogZohoScopeSql('birlaopus');
        expect(s).toMatch(/AND \(/);
        expect(s.toUpperCase()).toContain('BIRLA');
        expect(s.toUpperCase()).toContain('ZOHO_ITEM_NAME');
    });
    test('case-insensitive brand key', () => {
        expect(catalogZohoScopeSql('BirlaOpus')).toBe(catalogZohoScopeSql('birlaopus'));
    });
    test('unknown brand → empty string (no scope)', () => {
        expect(catalogZohoScopeSql('asianpaints')).toBe('');
        expect(catalogZohoScopeSql('')).toBe('');
        expect(catalogZohoScopeSql(undefined)).toBe('');
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog-endpoints.test.js` → FAIL (`catalogZohoScopeSql` is not a function).

- [ ] **Step 3: Add the helper** — in `routes/zoho.js`, immediately AFTER the `assertSupportedBrand` function (it ends with its closing `}` near line 106, just before the `// ========================================\n// DPL CATALOG` comment), insert:

```javascript
// Per-brand SQL scope (a WHERE fragment, literal patterns only — no params) for
// catalog candidate Zoho items. Tolerant: the brand column OR the item name carries
// the brand, so blank-brand items whose NAME says the brand are still candidates.
// Unknown brand → '' (no scope). assertSupportedBrand already gates to birlaopus.
const CATALOG_ZOHO_SCOPE = {
    birlaopus: "(UPPER(COALESCE(zoho_brand,'')) LIKE '%BIRLA%' OR UPPER(zoho_item_name) LIKE '%BIRLA OPUS%')",
};
function catalogZohoScopeSql(brand) {
    const s = CATALOG_ZOHO_SCOPE[String(brand || '').toLowerCase()];
    return s ? ` AND ${s}` : '';
}
```

- [ ] **Step 4: Apply the scope in the build query** — in the `POST /items/dpl-catalog/:brand/build` handler, find:

```javascript
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                    zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
                    zoho_description AS description
             FROM zoho_items_map WHERE zoho_status = 'active'`
        );
```
Replace with:

```javascript
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                    zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
                    zoho_description AS description
             FROM zoho_items_map WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );
```

- [ ] **Step 5: Export the helper** — in `routes/zoho.js`, change:

```javascript
module.exports = {
    router,
    setPool
};
```
to:

```javascript
module.exports = {
    router,
    setPool,
    catalogZohoScopeSql
};
```

- [ ] **Step 6: Run, verify PASS + module load**

```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog-endpoints.test.js tests/unit/dpl-catalog.test.js
```
Expected: `zoho OK` and all pass (incl. the 3 new `catalogZohoScopeSql` tests).

- [ ] **Step 7: Commit**

```bash
git add routes/zoho.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "fix(dpl-catalog): scope build candidates to the brand (no cross-brand matches)"
```

---

## Task 2: Scope the manual re-pick to Birla

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Add the brand filter to the picker fetch** — in `catPickerSearch`, find:

```javascript
            var resp = await fetch('/api/zoho/items?limit=40&search=' + encodeURIComponent(q), { headers: { 'Authorization': 'Bearer ' + getToken() } });
```
Replace with:

```javascript
            var resp = await fetch('/api/zoho/items?limit=40&brand=BIRLA&search=' + encodeURIComponent(q), { headers: { 'Authorization': 'Bearer ' + getToken() } });
```
(The catalog is Birla-only v1; `brand=BIRLA` makes `/items` filter `zoho_brand LIKE '%BIRLA%'`, so the re-pick can no longer offer Astral/other-brand items.)

- [ ] **Step 2: Sanity** — grep that the picker fetch now contains `brand=BIRLA`; confirm it is the only change.

- [ ] **Step 3: Commit**

```bash
git add public/admin-dpl.html
git commit -m "fix(dpl-catalog-ui): scope catalog re-pick search to Birla"
```

---

## Self-Review notes (spec coverage)

- **Tolerant brand scope (brand OR name), helper + applied to build:** Task 1 Steps 3-4. ✓
- **Exported + unit-tested:** Task 1 Steps 1,5. ✓
- **Picker scoped to brand:** Task 2. ✓
- **No service/linker change:** only the endpoint query + UI fetch touched. ✓

## Post-deploy (controller runs, not a subagent task)

1. Push + deploy.
2. Rebuild: `POST /api/zoho/items/dpl-catalog/birlaopus/build` (via the UI "🗂️ Build Catalog" or an authenticated curl). Idempotent (upsert by match_key); now uses brand-scoped candidates.
3. Verify on prod: zero `dpl_catalog` entries link to a non-Birla `zoho_brand`; spot-check `Colorant - Black → OPCLBL`, `White → OPCLWT`, `Green → OPCLGR`, etc.

## Out of scope

The linker algorithm, the proposer, `confirmLink`, other brands, the generic `/items` endpoint's existing behaviour.
