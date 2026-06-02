# DPL Catalog — Sub-Plan 1: Data Model + Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `dpl_catalog` table and a `services/dpl-catalog.js` service (size-tier normalizer, match-key, **deterministic** Zoho linker with size-tier equivalence, catalog builder, price-apply) — the no-UI foundation for the DPL Catalog feature.

**Architecture:** A persistent catalog mediates between a brand's DPL price list and Zoho items. The linker is **deterministic** — it matches a DPL entry to a Zoho item by slug-containment of the product name + base, with size compared by **TIER** (so a DPL `900ml` entry links to a Zoho `1L` item). It deliberately avoids the existing fuzzy abbreviation helpers (the source of today's mis-matches). Pure functions are fully unit-tested; DB methods use the established `setPool` injection pattern.

**Tech Stack:** Node/Express (CommonJS), mysql2 pool, Jest (pure-function + mock-pool tests, no supertest). Reuses only `computeProposedFields` from `services/price-list-parser.js` (already exported).

**Spec:** `docs/superpowers/specs/2026-06-02-dpl-catalog-design.md`

---

## File Structure

- **New** `migrations/migrate-dpl-catalog.js` — `dpl_catalog` table (`match_key` UNIQUE).
- **New** `services/dpl-catalog.js` — pure helpers (`slug`, `normalizeSizeTier`, `extractSizeFromZohoName`, `buildMatchKey`, `linkEntryToZoho`, `buildCatalogFromDpl`, `applyDplPrices`) + DB layer (`setPool`, `upsertEntries`, `getCatalog`, `confirmLink`). One responsibility: maintain the brand catalog and deterministically link entries to Zoho.
- **New tests** `tests/unit/dpl-catalog.test.js`.

No changes to `price-list-parser.js` are needed: the only reuse is `computeProposedFields` (already exported). The matching logic is self-contained so it is deterministic and fully testable with synthetic fixtures.

---

## Task 1: `migrations/migrate-dpl-catalog.js` — the table

**Files:**
- Create: `migrations/migrate-dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dpl-catalog.test.js`:

```javascript
describe('migrate-dpl-catalog', () => {
    test('exports up() and creates the table idempotently', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        expect(typeof mig.up).toBe('function');

        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[]]; // table absent
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE dpl_catalog/.test(q))).toBe(true);
        expect(queries.some(q => /match_key/.test(q) && /UNIQUE/.test(q))).toBe(true);
    });

    test('up() skips creation when the table already exists', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[{ t: 'dpl_catalog' }]]; // present
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE/.test(q))).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js`
Expected: FAIL — `Cannot find module '../../migrations/migrate-dpl-catalog'`.

- [ ] **Step 3: Create the migration**

Create `migrations/migrate-dpl-catalog.js`:

```javascript
/**
 * DPL Catalog Migration
 *
 * dpl_catalog mediates between a brand's DPL price list and Zoho items.
 * One row per canonical (brand, product, base, size_tier), identified by
 * match_key (the single UNIQUE index — avoids NULL/empty composite-key pitfalls).
 * Size is stored as a canonical TIER (200ml/1L/4L/10L/20L); the DPL's actual
 * label is kept in dpl_size_label. A confirmed zoho_item_id is the pinned
 * push target for future DPL updates.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'dpl_catalog'");
    if (tables.length) {
        console.log('  dpl_catalog already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE dpl_catalog (
            id                     INT           NOT NULL AUTO_INCREMENT,
            brand                  VARCHAR(40)   NOT NULL,
            match_key              VARCHAR(255)  NOT NULL,
            category               VARCHAR(120)  DEFAULT NULL,
            product_code           VARCHAR(20)   DEFAULT NULL,
            product_name           VARCHAR(160)  NOT NULL,
            base_name              VARCHAR(80)   DEFAULT NULL,
            size_tier              VARCHAR(12)   NOT NULL,
            dpl_size_label         VARCHAR(20)   DEFAULT NULL,
            zoho_item_id           VARCHAR(40)   DEFAULT NULL,
            canonical_name         VARCHAR(255)  DEFAULT NULL,
            canonical_sku          VARCHAR(64)   DEFAULT NULL,
            canonical_description  VARCHAR(255)  DEFAULT NULL,
            current_dpl            DECIMAL(12,2) DEFAULT NULL,
            current_rate           DECIMAL(12,2) DEFAULT NULL,
            link_status            ENUM('confirmed','review','needs_creating') NOT NULL DEFAULT 'review',
            link_confidence        TINYINT       DEFAULT NULL,
            link_reason            VARCHAR(120)  DEFAULT NULL,
            updated_by             VARCHAR(100)  DEFAULT NULL,
            created_at             TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
            updated_at             TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_match_key (match_key),
            KEY idx_brand (brand),
            KEY idx_zoho_item (zoho_item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created dpl_catalog table');
}

module.exports = { up };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add migrations/migrate-dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): dpl_catalog table migration"
```

---

## Task 2: pure size/slug helpers — `slug`, `normalizeSizeTier`, `extractSizeFromZohoName`

**Files:**
- Create: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append:

```javascript
const catalog = require('../../services/dpl-catalog');

describe('slug', () => {
    test('lowercases and strips non-alphanumerics', () => {
        expect(catalog.slug('One Pure Elegance')).toBe('onepureelegance');
        expect(catalog.slug('Base 2')).toBe('base2');
        expect(catalog.slug(null)).toBe('');
    });
});

describe('normalizeSizeTier', () => {
    const cases = [
        ['200ml', '200ml'], ['200 ML', '200ml'],
        ['900ml', '1L'], ['0.9L', '1L'], ['1L', '1L'],
        ['3.6L', '4L'], ['4L', '4L'],
        ['9L', '10L'], ['10L', '10L'],
        ['18L', '20L'], ['20L', '20L'],
        ['25kg', '25kg'],   // unknown unit → verbatim
    ];
    test.each(cases)('normalizeSizeTier(%s) === %s', (input, expected) => {
        expect(catalog.normalizeSizeTier(input)).toBe(expected);
    });
});

describe('extractSizeFromZohoName', () => {
    test('takes the last size-with-unit, ignoring leading category codes', () => {
        // "EP01" must NOT be read as a size; the trailing "1 L" is the size.
        expect(catalog.extractSizeFromZohoName('EP01 PEWH One Pure Elegance White 1 L', 'PEWH01')).toBe('1L');
        expect(catalog.extractSizeFromZohoName('PE BASE2 ONE PURE ELEGANCE BASE 2 BIRLA OPUS 4L', 'PEBASE2-4L')).toBe('4L');
        expect(catalog.extractSizeFromZohoName('... 200ml', 'X-200ML')).toBe('200ml');
    });
    test('returns empty string when no size present', () => {
        expect(catalog.extractSizeFromZohoName('Some Colorant Tint', 'CLT')).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t normalizeSizeTier`
Expected: FAIL — `Cannot find module '../../services/dpl-catalog'`.

- [ ] **Step 3: Create the service with these pure helpers**

Create `services/dpl-catalog.js`:

```javascript
/**
 * dpl-catalog.js — per-brand DPL catalog: the mediator between a brand's
 * Dealer Price List and Zoho items. Deterministic, self-contained matching
 * (slug-containment + size-tier), plus a thin DB layer (setPool injection).
 */
const { computeProposedFields } = require('./price-list-parser');

let pool;
function setPool(p) { pool = p; }

// ── Pure helpers ────────────────────────────────────────────────

function slug(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Collapse a pack-size label to its canonical TIER (the round size Zoho stores).
// 900ml/0.9L → 1L, 3.6L → 4L, 9L → 10L, 18L → 20L. 200ml is its own tier.
// Unknown units (kg, etc.) are returned verbatim so nothing is silently dropped.
function normalizeSizeTier(label) {
    const s = String(label == null ? '' : label).replace(/\s+/g, '').toLowerCase();
    const ml = s.match(/^(\d+(?:\.\d+)?)ml$/);
    if (ml) {
        const v = parseFloat(ml[1]);
        if (v >= 800 && v <= 1050) return '1L';
        return Math.round(v) + 'ml';
    }
    const lt = s.match(/^(\d+(?:\.\d+)?)(?:l|lt|ltr|litres?|liters?)?$/);
    const isLitre = lt && (/(?:l|lt|ltr|litres?|liters?)$/.test(s) || /^\d+(?:\.\d+)?$/.test(s));
    if (isLitre) {
        const n = parseFloat(lt[1]);
        if (n >= 0.8 && n <= 1.05) return '1L';
        if (n > 3.0 && n < 4.5) return '4L';
        if (n > 8.0 && n < 11.0) return '10L';
        if (n > 16.0 && n <= 20.0) return '20L';
        return n + 'L';
    }
    return String(label == null ? '' : label).trim();
}

// Pull the pack size out of a Zoho item's name/SKU. Requires a digit
// IMMEDIATELY followed by a unit, and takes the LAST such match, so a leading
// category code like "EP01" is never mistaken for a size.
function extractSizeFromZohoName(name, sku) {
    const text = String(name || '') + ' ' + String(sku || '');
    const re = /(\d+(?:\.\d+)?)\s*(ml|ltr|lt|l)\b/gi;
    let m, last = null;
    while ((m = re.exec(text))) last = m;
    if (!last) return '';
    return last[2].toLowerCase() === 'ml' ? (last[1] + 'ml') : (last[1] + 'L');
}

module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js`
Expected: PASS (the migrate, slug, normalizeSizeTier, extractSizeFromZohoName blocks).

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): pure size-tier + slug + zoho-size helpers"
```

---

## Task 3: `buildMatchKey`

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append:

```javascript
describe('buildMatchKey', () => {
    test('uses product_code when present', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L' });
        expect(k).toBe('birlaopus|941001|white|1l');
    });
    test('same product+base at 900ml and 1L collapse to the SAME key', () => {
        const a = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('900ml') });
        const b = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('1L') });
        expect(a).toBe(b);
        expect(a).toBe('birlaopus|941001|base2|1l');
    });
    test('falls back to product_name slug when no product_code', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '', product_name: 'Royale Aspira', base_name: 'White', size_tier: '4L' });
        expect(k).toBe('birlaopus|royaleaspira|white|4l');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t buildMatchKey`
Expected: FAIL — `catalog.buildMatchKey is not a function`.

- [ ] **Step 3: Add `buildMatchKey`**

In `services/dpl-catalog.js`, add before `module.exports`:

```javascript
function buildMatchKey({ brand, product_code, product_name, base_name, size_tier }) {
    const code = (product_code && String(product_code).trim())
        ? String(product_code).trim().toLowerCase()
        : slug(product_name);
    return [slug(brand), code, slug(base_name), slug(size_tier)].join('|');
}
```

Update exports:

```javascript
module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js -t buildMatchKey`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): buildMatchKey stable identity"
```

---

## Task 4: `linkEntryToZoho` — the deterministic, tier-aware linker (core)

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append. Zoho stores every base at ROUND sizes; the linker matches by product-name + base **slug-containment** and size **tier**:

```javascript
describe('linkEntryToZoho', () => {
    const zoho = [
        { zoho_item_id: 'Z1', name: 'EP01 PEWH One Pure Elegance White 1 L', sku: 'PEWH01' },
        { zoho_item_id: 'Z2', name: 'EP01 PEB2 One Pure Elegance Base 2 1 L', sku: 'PEB201' },
        { zoho_item_id: 'Z3', name: 'EP04 PEWH One Pure Elegance White 4 L', sku: 'PEWH04' },
    ];

    test('S1 exact canonical SKU wins', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L', canonical_sku: 'PEWH01' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('exact-sku');
        expect(r.link_confidence).toBe(100);
    });

    test('S2 product+base+size-tier links a DPL 900ml base to the Zoho 1L item', () => {
        const entry = { product_name: 'One Pure Elegance', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('900ml') };
        const r = catalog.linkEntryToZoho(entry, zoho);
        expect(r.zoho_item_id).toBe('Z2');
        expect(r.link_reason).toBe('product+base+tier');
        expect(r.link_status).toBe('confirmed');
    });

    test('White 1L links to Z1, not the 4L Z3', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
    });

    test('no product match → needs_creating', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'Nonexistent Product', base_name: 'White', size_tier: '20L' }, zoho);
        expect(r.zoho_item_id).toBe(null);
        expect(r.link_status).toBe('needs_creating');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t linkEntryToZoho`
Expected: FAIL — `catalog.linkEntryToZoho is not a function`.

- [ ] **Step 3: Add `linkEntryToZoho`**

In `services/dpl-catalog.js`, add before `module.exports`:

```javascript
// Build a (productMatch, baseMatch, sizeTier) probe for a Zoho item.
function zohoProbe(zi) {
    const name = zi.name || zi.zoho_item_name || '';
    const sku = zi.sku || zi.zoho_sku || '';
    return {
        zi,
        nameSlug: slug(name + ' ' + sku),
        sizeTier: normalizeSizeTier(extractSizeFromZohoName(name, sku)),
    };
}

// Link one catalog entry to exactly one Zoho item — DETERMINISTIC, no fuzzy abbrev.
//   S1 exact canonical SKU (100)
//   S2 product-name + base contained in the Zoho name AND size-tier equal (90, confirmed)
//   S3 product-name contained + size-tier equal, base ignored (70, review)
//   else needs_creating.
// Size is always compared by TIER, so a DPL 900ml entry (tier 1L) links to a Zoho 1L item.
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // S1
    if (entry.canonical_sku) {
        const want = String(entry.canonical_sku).toUpperCase();
        const hit = items.find(z => String(z.sku || z.zoho_sku || '').toUpperCase() === want);
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 100, link_reason: 'exact-sku' };
    }

    const eProd = slug(entry.product_name);
    const eBase = slug(entry.base_name);
    const eTier = entry.size_tier;
    const probes = items.map(zohoProbe);

    // S2: product + base + tier
    const s2 = probes.filter(p =>
        eProd && p.nameSlug.includes(eProd) && p.sizeTier === eTier &&
        (eBase === '' ? true : p.nameSlug.includes(eBase))
    );
    if (s2.length === 1) return { zoho_item_id: s2[0].zi.zoho_item_id, link_status: 'confirmed', link_confidence: 90, link_reason: 'product+base+tier' };
    if (s2.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 60, link_reason: 'ambiguous-product+base+tier' };

    // S3: product + tier (any base) — softer, needs review
    const s3 = probes.filter(p => eProd && p.nameSlug.includes(eProd) && p.sizeTier === eTier);
    if (s3.length === 1) return { zoho_item_id: s3[0].zi.zoho_item_id, link_status: 'review', link_confidence: 70, link_reason: 'product+tier-only' };
    if (s3.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 50, link_reason: 'ambiguous-product+tier' };

    return { zoho_item_id: null, link_status: 'needs_creating', link_confidence: 0, link_reason: 'no-match' };
}
```

Update exports:

```javascript
module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey, linkEntryToZoho };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js -t linkEntryToZoho`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): deterministic tier-aware Zoho linker"
```

---

## Task 5: `buildCatalogFromDpl` (structural entries + canonical + link)

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append. Rows are `parseBirlaOpusTabular` output `{product, packSize, dpl, category, brand, baseCode}` where `product` is `"Name - Shade"`:

```javascript
describe('buildCatalogFromDpl', () => {
    const zoho = [
        { zoho_item_id: 'Z1', name: 'EP01 PEWH One Pure Elegance White 1 L', sku: 'PEWH01', description: '', category: 'Interior Luxury' },
        { zoho_item_id: 'Z2', name: 'EP01 PEB2 One Pure Elegance Base 2 1 L', sku: 'PEB201', description: '', category: 'Interior Luxury' },
    ];
    const rows = [
        { product: 'One Pure Elegance - White', packSize: '1L', dpl: 490, category: 'Interior Luxury', brand: 'Birla Opus', baseCode: '941001' },
        { product: 'One Pure Elegance - Base 2', packSize: '900ml', dpl: 520, category: 'Interior Luxury', brand: 'Birla Opus', baseCode: '941001' },
    ];

    test('one entry per row with tier, match_key, current price, link', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        expect(entries).toHaveLength(2);
        const white = entries.find(e => e.base_name === 'White');
        expect(white.size_tier).toBe('1L');
        expect(white.dpl_size_label).toBe('1L');
        expect(white.current_dpl).toBe(490);
        expect(white.current_rate).toBe(Math.ceil(490 * 1.18 * 1.10));
        expect(white.match_key).toBe('birlaopus|941001|white|1l');
        expect(white.zoho_item_id).toBe('Z1');
        expect(white.link_status).toBe('confirmed');
    });

    test('a DPL 900ml base normalizes to tier 1L and links to the Zoho 1L item', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        const base2 = entries.find(e => e.base_name === 'Base 2');
        expect(base2.size_tier).toBe('1L');
        expect(base2.dpl_size_label).toBe('900ml');
        expect(base2.zoho_item_id).toBe('Z2');
        expect(base2.link_status).toBe('confirmed');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t buildCatalogFromDpl`
Expected: FAIL — `catalog.buildCatalogFromDpl is not a function`.

- [ ] **Step 3: Add `splitProductBase` + `buildCatalogFromDpl`**

In `services/dpl-catalog.js`, add before `module.exports`:

```javascript
// Split the tabular parser's merged "Name - Shade" product field.
function splitProductBase(product) {
    const s = String(product || '');
    const idx = s.lastIndexOf(' - ');
    if (idx === -1) return { product_name: s.trim(), base_name: '' };
    return { product_name: s.slice(0, idx).trim(), base_name: s.slice(idx + 3).trim() };
}

function buildCatalogFromDpl(brand, parsedRows, zohoItems) {
    const out = [];
    for (const row of (parsedRows || [])) {
        const { product_name, base_name } = splitProductBase(row.product);
        const size_tier = normalizeSizeTier(row.packSize);
        const dpl = parseFloat(row.dpl) || 0;
        const entry = {
            brand,
            category: row.category || null,
            product_code: row.baseCode || '',
            product_name,
            base_name,
            size_tier,
            dpl_size_label: row.packSize || null,
            current_dpl: dpl || null,
            current_rate: dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null,
            zoho_item_id: null,
            canonical_name: null,
            canonical_sku: null,
            canonical_description: null,
            link_status: 'needs_creating',
            link_confidence: 0,
            link_reason: 'no-match',
        };
        entry.match_key = buildMatchKey(entry);

        Object.assign(entry, linkEntryToZoho(entry, zohoItems));

        // Canonical name/sku/desc for LINKED entries (reuse the proven Birla proposer).
        if (entry.zoho_item_id) {
            const zi = (zohoItems || []).find(z => z.zoho_item_id === entry.zoho_item_id);
            if (zi) {
                const pf = computeProposedFields(
                    { product: row.product, packSize: row.packSize, dpl, category: row.category },
                    { sku: zi.sku || zi.zoho_sku || '', description: zi.description || '', category: zi.category || zi.zoho_category_name || '' },
                    'birlaopus'
                );
                entry.canonical_name = pf.proposed_name || null;
                entry.canonical_sku = pf.proposed_sku || null;
                entry.canonical_description = pf.proposed_description || null;
            }
        }
        out.push(entry);
    }
    return out;
}
```

Update exports:

```javascript
module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey, linkEntryToZoho, buildCatalogFromDpl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js -t buildCatalogFromDpl`
Expected: PASS (2 tests). (The canonical_* fields come from `computeProposedFields`; the tests assert only structure/tier/link, which do not depend on the exact canonical string.)

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): buildCatalogFromDpl with tier + canonical + link"
```

---

## Task 6: `applyDplPrices` (price refresh on re-upload, no re-fuzz)

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append:

```javascript
describe('applyDplPrices', () => {
    const existing = [
        { id: 1, match_key: 'birlaopus|941001|white|1l', zoho_item_id: 'Z1', current_dpl: 490 },
        { id: 2, match_key: 'birlaopus|941001|base2|1l', zoho_item_id: 'Z2', current_dpl: 520 },
    ];
    const rows = [
        { product: 'One Pure Elegance - White', packSize: '1L', dpl: 510, baseCode: '941001' },    // price change
        { product: 'One Pure Elegance - Base 3', packSize: '4L', dpl: 1800, baseCode: '941001' },   // new, not in catalog
    ];

    test('updates matched entries, flags new ones, lists untouched', () => {
        const res = catalog.applyDplPrices('birlaopus', rows, existing);
        expect(res.updated).toHaveLength(1);
        expect(res.updated[0].match_key).toBe('birlaopus|941001|white|1l');
        expect(res.updated[0].new_dpl).toBe(510);
        expect(res.updated[0].new_rate).toBe(Math.ceil(510 * 1.18 * 1.10));
        expect(res.updated[0].old_dpl).toBe(490);

        expect(res.newNeedsLinking).toHaveLength(1);
        expect(res.newNeedsLinking[0].match_key).toBe('birlaopus|941001|base3|4l');

        expect(res.noDplThisTime.map(e => e.match_key)).toContain('birlaopus|941001|base2|1l');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t applyDplPrices`
Expected: FAIL — `catalog.applyDplPrices is not a function`.

- [ ] **Step 3: Add `applyDplPrices`**

In `services/dpl-catalog.js`, add before `module.exports`:

```javascript
// Re-key incoming DPL rows to the existing catalog and compute the price delta.
// No fuzzy matching — entries are already pinned. Returns three buckets.
function applyDplPrices(brand, parsedRows, existingCatalog) {
    const byKey = new Map((existingCatalog || []).map(e => [e.match_key, e]));
    const seen = new Set();
    const updated = [];
    const newNeedsLinking = [];

    for (const row of (parsedRows || [])) {
        const { product_name, base_name } = splitProductBase(row.product);
        const size_tier = normalizeSizeTier(row.packSize);
        const match_key = buildMatchKey({ brand, product_code: row.baseCode || '', product_name, base_name, size_tier });
        const dpl = parseFloat(row.dpl) || 0;
        const new_rate = dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null;

        const existing = byKey.get(match_key);
        if (existing) {
            seen.add(match_key);
            updated.push({
                id: existing.id, match_key, zoho_item_id: existing.zoho_item_id,
                old_dpl: existing.current_dpl != null ? parseFloat(existing.current_dpl) : null,
                new_dpl: dpl, new_rate,
            });
        } else {
            newNeedsLinking.push({ match_key, product_name, base_name, size_tier, dpl_size_label: row.packSize, new_dpl: dpl, new_rate });
        }
    }

    const noDplThisTime = (existingCatalog || []).filter(e => !seen.has(e.match_key));
    return { updated, newNeedsLinking, noDplThisTime };
}
```

Update exports:

```javascript
module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey, linkEntryToZoho, buildCatalogFromDpl, applyDplPrices };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js -t applyDplPrices`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): applyDplPrices price-delta on re-upload"
```

---

## Task 7: DB layer (`upsertEntries`, `getCatalog`, `confirmLink`)

**Files:**
- Modify: `services/dpl-catalog.js`
- Test: `tests/unit/dpl-catalog.test.js` (append)

- [ ] **Step 1: Write the failing test (mock pool)**

Append:

```javascript
describe('dpl-catalog DB layer', () => {
    test('upsertEntries issues an INSERT ... ON DUPLICATE KEY per entry', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } });
        await catalog.upsertEntries([
            { brand: 'birlaopus', match_key: 'birlaopus|941001|white|1l', category: 'Interior Luxury', product_code: '941001', product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L', dpl_size_label: '1L', zoho_item_id: 'Z1', canonical_name: 'X', canonical_sku: 'PEWH01', canonical_description: 'D', current_dpl: 490, current_rate: 636, link_status: 'confirmed', link_confidence: 90, link_reason: 'product+base+tier' },
        ], 'tester');
        expect(calls.length).toBe(1);
        expect(/INSERT INTO dpl_catalog/i.test(calls[0].sql)).toBe(true);
        expect(/ON DUPLICATE KEY UPDATE/i.test(calls[0].sql)).toBe(true);
        expect(calls[0].params).toContain('birlaopus|941001|white|1l');
    });

    test('getCatalog selects by brand', async () => {
        let captured;
        catalog.setPool({ query: async (sql, params) => { captured = { sql, params }; return [[{ id: 1 }]]; } });
        const rows = await catalog.getCatalog('birlaopus');
        expect(rows).toEqual([{ id: 1 }]);
        expect(/FROM dpl_catalog WHERE brand = \?/i.test(captured.sql)).toBe(true);
        expect(captured.params).toEqual(['birlaopus']);
    });

    test('confirmLink pins zoho_item_id and sets status confirmed', async () => {
        let captured;
        catalog.setPool({ query: async (sql, params) => { captured = { sql, params }; return [{ affectedRows: 1 }]; } });
        await catalog.confirmLink(7, 'Z9', 'tester');
        expect(/UPDATE dpl_catalog SET/i.test(captured.sql)).toBe(true);
        expect(/zoho_item_id = \?/i.test(captured.sql)).toBe(true);
        expect(/link_status = 'confirmed'/i.test(captured.sql)).toBe(true);
        expect(captured.params).toEqual(['Z9', 'tester', 7]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog.test.js -t "DB layer"`
Expected: FAIL — `catalog.upsertEntries is not a function`.

- [ ] **Step 3: Add the DB methods**

In `services/dpl-catalog.js`, add before `module.exports`:

```javascript
const _COLS = [
    'brand', 'match_key', 'category', 'product_code', 'product_name', 'base_name',
    'size_tier', 'dpl_size_label', 'zoho_item_id', 'canonical_name', 'canonical_sku',
    'canonical_description', 'current_dpl', 'current_rate', 'link_status',
    'link_confidence', 'link_reason', 'updated_by',
];

async function upsertEntries(entries, updatedBy) {
    for (const e of (entries || [])) {
        const row = { ...e, updated_by: updatedBy || null };
        const values = _COLS.map(c => (row[c] === undefined ? null : row[c]));
        const placeholders = _COLS.map(() => '?').join(', ');
        // On conflict (same match_key) update everything except the identity columns.
        const updates = _COLS.filter(c => c !== 'brand' && c !== 'match_key')
            .map(c => `${c} = VALUES(${c})`).join(', ');
        await pool.query(
            `INSERT INTO dpl_catalog (${_COLS.join(', ')}) VALUES (${placeholders})
             ON DUPLICATE KEY UPDATE ${updates}`,
            values
        );
    }
}

async function getCatalog(brand) {
    const [rows] = await pool.query(
        `SELECT * FROM dpl_catalog WHERE brand = ? ORDER BY category, product_name, base_name, size_tier`,
        [brand]
    );
    return rows;
}

async function confirmLink(id, zohoItemId, updatedBy) {
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', updated_by = ? WHERE id = ?`,
        [zohoItemId, updatedBy || null, id]
    );
}
```

Update exports to the full set:

```javascript
module.exports = {
    setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey,
    linkEntryToZoho, buildCatalogFromDpl, applyDplPrices,
    upsertEntries, getCatalog, confirmLink,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog.test.js -t "DB layer"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): DB layer upsert/get/confirmLink"
```

---

## Task 8: Full verification

- [ ] **Step 1: Syntax + module load + full new suite + DPL regression**

Run:
```bash
node --check services/dpl-catalog.js && node --check migrations/migrate-dpl-catalog.js
node -e "require('./services/dpl-catalog.js'); require('./migrations/migrate-dpl-catalog.js'); console.log('modules OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-naming.test.js tests/unit/dpl-tabular-parser.test.js tests/unit/dpl-price-size.test.js
```
Expected: `modules OK` and all suites PASS.

- [ ] **Step 2: Apply the migration on the DB (deploy action, when promoting)**

The `dpl_catalog` table must exist before sub-plans 2/3 run. Apply via the project's migration runner or directly (idempotent — guarded by `SHOW TABLES LIKE`). Record that it was applied. Do NOT run DB-mutating commands during unit testing.

---

## Notes for sub-plans 2 & 3 (not in this plan)

- **Sub-plan 2** (build + review API + UI): `POST /api/zoho/items/dpl-catalog/:brand/build` (`buildCatalogFromDpl` + `upsertEntries` against the active `zoho_items_map`), `GET .../dpl-catalog/:brand` (`getCatalog`), `POST .../dpl-catalog/entry/:id/confirm-link` (`confirmLink`); a "Catalog" review state in `admin-dpl.html` with product grouping, confidence/warning flags, and a Zoho re-pick picker.
- **Sub-plan 3** (price update + push): `POST .../dpl-catalog/:brand/apply-prices` (`applyDplPrices` + diff), wire confirmed entries into the existing `bulk-edit` push (cf_dpl/purchase_rate/rate + canonical name/sku/category when they differ), log `dpl_price_history`.
- **Real-data validation (do once in sub-plan 2):** before trusting the linker on production, fetch ~10 real Birla items — `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku FROM zoho_items_map WHERE zoho_status='active' AND zoho_brand LIKE '%BIRLA%' LIMIT 10` — and confirm `extractSizeFromZohoName` + product/base slug-containment resolve them as expected. Adjust the containment normalization if real names abbreviate the product (e.g. add a token-overlap fallback), keeping the size-tier behavior intact.
```
