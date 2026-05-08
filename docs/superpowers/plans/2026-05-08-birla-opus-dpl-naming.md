# Birla Opus DPL Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `computeProposedFields()` so DPL upload review shows canonical Birla Opus item names — emulsion stripped of variant suffix, enamel preserves color, no duplicate SKU prefix at start of name.

**Architecture:** Single-file change in `services/price-list-parser.js`. Add 5 pure helpers and one template builder, then route the existing Birla Opus branch through the builder. New helpers are exported so they're directly testable. UI (`admin-dpl.html`) consumes `proposed_name` unchanged — no UI work.

**Tech Stack:** Node.js, Jest (existing test framework, configured in `package.json`).

**Spec:** [`docs/superpowers/specs/2026-05-08-birla-opus-dpl-naming-design.md`](../specs/2026-05-08-birla-opus-dpl-naming-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/price-list-parser.js` | Modify | Add 5 helpers + `buildBirlaName()`; rewrite Birla Opus branch in `computeProposedFields()`; export helpers. |
| `tests/unit/dpl-naming.test.js` | Create | Jest unit tests covering each helper + the integrated `computeProposedFields` for Birla Opus. |

---

## Task 1: Test scaffold + first failing test

**Files:**
- Create: `tests/unit/dpl-naming.test.js`

- [ ] **Step 1: Create the test file with the import and one failing emulsion test**

```js
// tests/unit/dpl-naming.test.js
const {
    isEmulsionCategory,
    isEnamelCategory,
    extractEmulsionProductName,
    extractEnamelProductAndColor,
    stripDuplicateSkuPrefix,
    buildBirlaName,
    computeProposedFields,
} = require('../../services/price-list-parser');

describe('Birla Opus DPL naming — scaffold', () => {
    test('all helpers are exported', () => {
        expect(typeof isEmulsionCategory).toBe('function');
        expect(typeof isEnamelCategory).toBe('function');
        expect(typeof extractEmulsionProductName).toBe('function');
        expect(typeof extractEnamelProductAndColor).toBe('function');
        expect(typeof stripDuplicateSkuPrefix).toBe('function');
        expect(typeof buildBirlaName).toBe('function');
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx jest tests/unit/dpl-naming.test.js -t "all helpers are exported"`

Expected: FAIL — `expect(typeof isEmulsionCategory).toBe('function')` because helpers don't exist yet (currently `undefined`).

- [ ] **Step 3: Commit the scaffold**

```bash
git add tests/unit/dpl-naming.test.js
git commit -m "test(dpl): scaffold Birla Opus naming test file"
```

---

## Task 2: `isEmulsionCategory` + `isEnamelCategory`

**Files:**
- Modify: `services/price-list-parser.js` (add helpers + export)
- Modify: `tests/unit/dpl-naming.test.js` (add tests)

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/dpl-naming.test.js` after the scaffold describe block:

```js
describe('isEmulsionCategory', () => {
    test('matches Interior Emulsion', () => {
        expect(isEmulsionCategory('INTERIOR EMULSION')).toBe(true);
    });
    test('matches Exterior Emulsion (case-insensitive)', () => {
        expect(isEmulsionCategory('Exterior Emulsion')).toBe(true);
    });
    test('rejects Enamel', () => {
        expect(isEmulsionCategory('ENAMEL')).toBe(false);
    });
    test('rejects null and empty', () => {
        expect(isEmulsionCategory(null)).toBe(false);
        expect(isEmulsionCategory('')).toBe(false);
    });
});

describe('isEnamelCategory', () => {
    test('matches ENAMEL', () => {
        expect(isEnamelCategory('ENAMEL')).toBe(true);
    });
    test('rejects Interior Emulsion', () => {
        expect(isEnamelCategory('INTERIOR EMULSION')).toBe(false);
    });
    test('rejects null', () => {
        expect(isEnamelCategory(null)).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx jest tests/unit/dpl-naming.test.js`

Expected: FAIL — `isEmulsionCategory is not a function`.

- [ ] **Step 3: Implement helpers in `services/price-list-parser.js`**

Locate the `// ============ MATCH WITH ZOHO ITEMS ============` comment near line 1067. Add the helpers immediately ABOVE it (i.e., after `function detectFinish` at ~line 1065):

```js
// ============ BIRLA OPUS NAMING HELPERS ============

// Category routing for proposed-name format selection.
function isEmulsionCategory(cat) {
    return /\bEMULSION\b/i.test(String(cat || ''));
}

function isEnamelCategory(cat) {
    return /\bENAMEL\b/i.test(String(cat || ''));
}
```

- [ ] **Step 4: Add the two functions to `module.exports`**

In the `module.exports = { ... }` block at the bottom of `services/price-list-parser.js`, add the entries (alphabetically near `extractBase`):

```js
    // Birla Opus naming helpers
    isEmulsionCategory,
    isEnamelCategory,
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js`

Expected: PASS for the new tests; the scaffold "all helpers are exported" still fails because the other 4 helpers are not yet defined — that's fine, we'll address them in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): add isEmulsionCategory + isEnamelCategory helpers"
```

---

## Task 3: `extractEmulsionProductName`

**Files:**
- Modify: `services/price-list-parser.js`
- Modify: `tests/unit/dpl-naming.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/dpl-naming.test.js`:

```js
describe('extractEmulsionProductName', () => {
    test('strips variant suffix and uppercases', () => {
        expect(extractEmulsionProductName('Ever Stay - White')).toBe('EVER STAY');
    });
    test('handles Pastel variant', () => {
        expect(extractEmulsionProductName('Calista Ever Clear - Pastel')).toBe('CALISTA EVER CLEAR');
    });
    test('keeps tier word ONE', () => {
        expect(extractEmulsionProductName('One Pure Elegance - Mid Tone')).toBe('ONE PURE ELEGANCE');
    });
    test('returns name unchanged when no separator', () => {
        expect(extractEmulsionProductName('Style Color Fresh')).toBe('STYLE COLOR FRESH');
    });
    test('skips ANNEXURE prefix and uses meaningful part', () => {
        expect(extractEmulsionProductName('Annexure - Calista Sparkle PU')).toBe('CALISTA SPARKLE PU');
    });
    test('handles empty', () => {
        expect(extractEmulsionProductName('')).toBe('');
        expect(extractEmulsionProductName(null)).toBe('');
    });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npx jest tests/unit/dpl-naming.test.js -t extractEmulsionProductName`

Expected: FAIL — function not defined.

- [ ] **Step 3: Implement the helper**

Add below `isEnamelCategory` in `services/price-list-parser.js`:

```js
// Emulsion product name = PDF product name with variant suffix stripped,
// ALL CAPS. If the leading "- " segment is "ANNEXURE", use the next segment
// instead (matches the existing `extractProductAbbrev` strategy).
function extractEmulsionProductName(pdfProduct) {
    if (!pdfProduct) return '';
    const parts = String(pdfProduct).split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    // Skip a leading ANNEXURE-style label if there is at least one more part
    let main = parts[0];
    if (/^ANNEXURE\b/i.test(main) && parts.length > 1) {
        main = parts[1];
    }
    return main.toUpperCase();
}
```

- [ ] **Step 4: Add to `module.exports`**

Add `extractEmulsionProductName,` near the helpers exported in Task 2.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js -t extractEmulsionProductName`

Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): add extractEmulsionProductName helper"
```

---

## Task 4: `extractEnamelProductAndColor`

**Files:**
- Modify: `services/price-list-parser.js`
- Modify: `tests/unit/dpl-naming.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/dpl-naming.test.js`:

```js
describe('extractEnamelProductAndColor', () => {
    test('splits product and color on dash', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Blue')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'BLUE',
        });
    });
    test('handles multi-word color', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Deep Orange')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'DEEP ORANGE',
        });
    });
    test('color empty when no separator', () => {
        expect(extractEnamelProductAndColor('Cover Max')).toEqual({
            productName: 'COVER MAX',
            color: '',
        });
    });
    test('handles empty', () => {
        expect(extractEnamelProductAndColor('')).toEqual({ productName: '', color: '' });
        expect(extractEnamelProductAndColor(null)).toEqual({ productName: '', color: '' });
    });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx jest tests/unit/dpl-naming.test.js -t extractEnamelProductAndColor`

Expected: FAIL.

- [ ] **Step 3: Implement**

Add below `extractEmulsionProductName` in `services/price-list-parser.js`:

```js
// Enamel product+color split — preserves the color (the part after " - ").
// Returns { productName, color }, both ALL CAPS. Color is empty if no dash.
function extractEnamelProductAndColor(pdfProduct) {
    if (!pdfProduct) return { productName: '', color: '' };
    const parts = String(pdfProduct).split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return { productName: '', color: '' };
    const productName = parts[0].toUpperCase();
    const color = parts.length > 1 ? parts.slice(1).join(' ').toUpperCase() : '';
    return { productName, color };
}
```

- [ ] **Step 4: Add to `module.exports`**

Add `extractEnamelProductAndColor,` to the exports.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js -t extractEnamelProductAndColor`

Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): add extractEnamelProductAndColor helper"
```

---

## Task 5: `stripDuplicateSkuPrefix`

**Files:**
- Modify: `services/price-list-parser.js`
- Modify: `tests/unit/dpl-naming.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/dpl-naming.test.js`:

```js
describe('stripDuplicateSkuPrefix', () => {
    test('strips leading SKU-prefix token (CSWT case)', () => {
        // SKU = CSWT20, name starts with "CSWT STYLE COLOR SMART ..."
        expect(stripDuplicateSkuPrefix('CSWT STYLE COLOR SMART BIRLA OPUS', 'CSWT20'))
            .toBe('STYLE COLOR SMART BIRLA OPUS');
    });
    test('strips full SKU + dangling unit (CSTSBK500ML case)', () => {
        // SKU = CSTSBK500ML, name = "CSTSBK500 ML CST SATIN BLACK ..."
        expect(stripDuplicateSkuPrefix('CSTSBK500 ML CST SATIN BLACK ENAMEL', 'CSTSBK500ML'))
            .toBe('CST SATIN BLACK ENAMEL');
    });
    test('strips full SKU + dangling L (AWPUEM01L case)', () => {
        expect(stripDuplicateSkuPrefix('AWPUEM01 L PU EXTERIOR MATT', 'AWPUEM01L'))
            .toBe('PU EXTERIOR MATT');
    });
    test('does not strip when name does not duplicate SKU', () => {
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY BIRLA OPUS', 'ES101'))
            .toBe('CALISTA EVER STAY BIRLA OPUS');
    });
    test('handles missing sku gracefully', () => {
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY', '')).toBe('CALISTA EVER STAY');
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY', null)).toBe('CALISTA EVER STAY');
    });
    test('handles empty name', () => {
        expect(stripDuplicateSkuPrefix('', 'CSWT20')).toBe('');
    });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx jest tests/unit/dpl-naming.test.js -t stripDuplicateSkuPrefix`

Expected: FAIL.

- [ ] **Step 3: Implement**

Add below `extractEnamelProductAndColor` in `services/price-list-parser.js`:

```js
// Remove leading tokens of `name` that duplicate the SKU.
// Strips: (a) full SKU exact match, (b) leading [A-Z]+ run of SKU followed by
// digits (e.g. "CSWT" from SKU "CSWT20"), (c) one dangling unit token (L/ML/KG)
// only when it follows a stripped SKU-like token. Stops at the first non-matching
// token. Pure function — no side effects.
function stripDuplicateSkuPrefix(name, sku) {
    if (!name || !sku) return name || '';
    const skuU = String(sku).toUpperCase();
    const skuAlphaMatch = skuU.match(/^[A-Z]+/);
    if (!skuAlphaMatch) return name;
    const skuAlpha = skuAlphaMatch[0]; // e.g. "CSWT", "CSTSBK", "AWPUEM"

    const tokens = String(name).trim().split(/\s+/);
    let stripped = false;
    while (tokens.length) {
        const t = tokens[0].toUpperCase();
        // Case (a): exact SKU match
        if (t === skuU) { tokens.shift(); stripped = true; continue; }
        // Case (b): starts with skuAlpha and contains only [A-Z0-9] (e.g. "CSWT", "CSTSBK500", "CSWT20")
        if (t.startsWith(skuAlpha) && /^[A-Z0-9]+$/.test(t) && t.length >= skuAlpha.length) {
            tokens.shift(); stripped = true; continue;
        }
        // Case (c): dangling unit token immediately after a strip
        if (stripped && /^(L|ML|KG)$/.test(t)) {
            tokens.shift();
            stripped = false; // only consume one trailing unit
            continue;
        }
        break;
    }
    return tokens.join(' ');
}
```

- [ ] **Step 4: Add to `module.exports`**

Add `stripDuplicateSkuPrefix,` to the exports.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js -t stripDuplicateSkuPrefix`

Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): add stripDuplicateSkuPrefix helper"
```

---

## Task 6: `buildBirlaName` template builder

**Files:**
- Modify: `services/price-list-parser.js`
- Modify: `tests/unit/dpl-naming.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/dpl-naming.test.js`:

```js
describe('buildBirlaName', () => {
    test('emulsion canonical: WT-base no duplicate', () => {
        expect(buildBirlaName({
            sku: 'ESWT01',
            pdfProduct: 'Calista Ever Stay - White',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBe('ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L');
    });

    test('emulsion canonical: non-WT base (Pastel)', () => {
        expect(buildBirlaName({
            sku: 'ES101',
            pdfProduct: 'Calista Ever Stay - Pastel',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBe('ES101 CALISTA EVER STAY BIRLA OPUS 01 L');
    });

    test('emulsion: ONE tier preserved, Mid Tone variant stripped', () => {
        expect(buildBirlaName({
            sku: 'PE204',
            pdfProduct: 'One Pure Elegance - Mid Tone',
            category: 'INTERIOR EMULSION',
            packFormatted: '04 L',
        })).toBe('PE204 ONE PURE ELEGANCE BIRLA OPUS 04 L');
    });

    test('exterior emulsion uses same emulsion format', () => {
        expect(buildBirlaName({
            sku: 'TL9920',
            pdfProduct: 'One True Look - Clear',
            category: 'EXTERIOR EMULSION',
            packFormatted: '20 L',
        })).toBe('TL9920 ONE TRUE LOOK BIRLA OPUS 20 L');
    });

    test('enamel: color preserved with ENAMEL keyword', () => {
        expect(buildBirlaName({
            sku: 'CSTBL01',
            pdfProduct: 'Calista Sparkle - Blue',
            category: 'ENAMEL',
            packFormatted: '01 L',
        })).toBe('CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L');
    });

    test('enamel: multi-word color', () => {
        expect(buildBirlaName({
            sku: 'CSTDOR01',
            pdfProduct: 'Calista Sparkle - Deep Orange',
            category: 'ENAMEL',
            packFormatted: '01 L',
        })).toBe('CSTDOR01 CALISTA SPARKLE ENAMEL DEEP ORANGE BIRLA OPUS 01 L');
    });

    test('enamel: no dash → empty color, no double space', () => {
        expect(buildBirlaName({
            sku: 'CME500',
            pdfProduct: 'Cover Max',
            category: 'ENAMEL',
            packFormatted: '500 ML',
        })).toBe('CME500 COVER MAX ENAMEL BIRLA OPUS 500 ML');
    });

    test('strips duplicate SKU prefix even if input PDF name contains it', () => {
        expect(buildBirlaName({
            sku: 'CSWT20',
            pdfProduct: 'CSWT Calista Color Smart - White',
            category: 'INTERIOR EMULSION',
            packFormatted: '20 L',
        })).toBe('CSWT20 CALISTA COLOR SMART BIRLA OPUS 20 L');
    });

    test('non-emulsion non-enamel falls back to emulsion format', () => {
        expect(buildBirlaName({
            sku: 'PHP20',
            pdfProduct: 'Style Pro Hide Primer',
            category: 'INTERIOR PRIMER',
            packFormatted: '20 L',
        })).toBe('PHP20 STYLE PRO HIDE PRIMER BIRLA OPUS 20 L');
    });

    test('returns null when sku missing', () => {
        expect(buildBirlaName({
            sku: '',
            pdfProduct: 'Ever Stay',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBeNull();
    });

    test('returns null when packFormatted missing', () => {
        expect(buildBirlaName({
            sku: 'ES101',
            pdfProduct: 'Ever Stay',
            category: 'INTERIOR EMULSION',
            packFormatted: '',
        })).toBeNull();
    });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx jest tests/unit/dpl-naming.test.js -t buildBirlaName`

Expected: FAIL — `buildBirlaName is not a function`.

- [ ] **Step 3: Implement**

Add below `stripDuplicateSkuPrefix` in `services/price-list-parser.js`:

```js
// Build the canonical Birla Opus proposed name.
// Routes to emulsion vs enamel format based on category.
// Returns null if `sku` or `packFormatted` is empty (caller falls back to base output).
function buildBirlaName({ sku, pdfProduct, category, packFormatted }) {
    if (!sku || !packFormatted) return null;
    const skuU = String(sku).toUpperCase();
    const brand = 'BIRLA OPUS';

    let body;
    if (isEnamelCategory(category)) {
        const { productName, color } = extractEnamelProductAndColor(pdfProduct);
        const cleanedProduct = stripDuplicateSkuPrefix(productName, skuU);
        body = color
            ? `${cleanedProduct} ENAMEL ${color}`
            : `${cleanedProduct} ENAMEL`;
    } else {
        // Emulsion (default): also covers any non-enamel category for now
        const productName = extractEmulsionProductName(pdfProduct);
        body = stripDuplicateSkuPrefix(productName, skuU);
    }

    // Collapse any accidental whitespace runs and assemble final string.
    return `${skuU} ${body} ${brand} ${packFormatted}`.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Add to `module.exports`**

Add `buildBirlaName,` to the exports block.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js -t buildBirlaName`

Expected: PASS, all 11 tests green.

- [ ] **Step 6: Run the full test file to confirm scaffold passes too**

Run: `npx jest tests/unit/dpl-naming.test.js`

Expected: ALL tests pass — including the original "all helpers are exported" scaffold test from Task 1.

- [ ] **Step 7: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): add buildBirlaName template builder"
```

---

## Task 7: Wire `computeProposedFields()` to use `buildBirlaName`

**Files:**
- Modify: `services/price-list-parser.js` (replace inline template at ~line 859-893)
- Modify: `tests/unit/dpl-naming.test.js` (add integration tests)

- [ ] **Step 1: Add integration tests for `computeProposedFields`**

Append to `tests/unit/dpl-naming.test.js`:

```js
describe('computeProposedFields — Birla Opus integration', () => {
    test('emulsion: WT-base no duplicate prefix in proposed_name', () => {
        const result = computeProposedFields(
            { dpl: 100, packSize: '1L', product: 'Calista Ever Stay - White', category: 'INTERIOR EMULSION' },
            { sku: 'ESWT01', description: '', category: 'INTERIOR EMULSION' },
            'birlaopus'
        );
        expect(result.proposed_name).toBe('ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L');
        expect(result.proposed_sku).toBe('ESWT01');
    });

    test('emulsion: ONE tier and Mid Tone variant stripped', () => {
        const result = computeProposedFields(
            { dpl: 200, packSize: '4L', product: 'One Pure Elegance - Mid Tone', category: 'INTERIOR EMULSION' },
            { sku: 'PE204', description: '', category: 'INTERIOR EMULSION' },
            'birlaopus'
        );
        expect(result.proposed_name).toBe('PE204 ONE PURE ELEGANCE BIRLA OPUS 04 L');
    });

    test('enamel: color preserved with ENAMEL keyword', () => {
        const result = computeProposedFields(
            { dpl: 150, packSize: '1L', product: 'Calista Sparkle - Blue', category: 'ENAMEL' },
            { sku: 'CSTBL01', description: '', category: 'ENAMEL' },
            'birlaopus'
        );
        expect(result.proposed_name).toBe('CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L');
    });

    test('non-birlaopus brand: returns base unchanged (no proposed_name)', () => {
        const result = computeProposedFields(
            { dpl: 100, packSize: '1L', product: 'Whatever', category: 'EMULSION' },
            { sku: 'XYZ01', description: '', category: 'EMULSION' },
            'asian'
        );
        expect(result.proposed_name).toBeUndefined();
        expect(result.proposed_rate).toBe(Math.ceil(100 * 1.18 * 1.10));
    });

    test('proposed_rate matches selling price formula', () => {
        const result = computeProposedFields(
            { dpl: 100, packSize: '1L', product: 'Ever Stay - White', category: 'INTERIOR EMULSION' },
            { sku: 'ESWT01', description: '', category: 'INTERIOR EMULSION' },
            'birlaopus'
        );
        expect(result.proposed_rate).toBe(Math.ceil(100 * 1.18 * 1.10));
    });
});
```

- [ ] **Step 2: Run, confirm failures (existing implementation produces old format)**

Run: `npx jest tests/unit/dpl-naming.test.js -t "computeProposedFields"`

Expected: FAIL — current `proposed_name` includes `ESWT01 ESWT EVER STAY BIRLA OPUS 01 L` (duplicate prefix) and lacks the enamel color path.

- [ ] **Step 3: Replace the Birla Opus branch in `computeProposedFields`**

Open `services/price-list-parser.js`, find `function computeProposedFields(...)` near line 859.

REPLACE the section from `if (brandKey !== 'birlaopus') return base;` through the closing `return { ...base, proposed_name: proposedName, proposed_sku: proposedSku, proposed_description: proposedDescription };` with:

```js
    if (brandKey !== 'birlaopus') return base;

    // SKU prefix = everything except last 2 pack-code chars, preserving base indicator
    // e.g. "ESWT01"→"ESWT", "ES201"→"ES2", "CS9901"→"CS99"
    const skuUpper  = currentSku.toUpperCase();
    const skuPrefix = skuUpper.length > 2 ? skuUpper.slice(0, -2) : null;
    // Normalize near-equivalent pack sizes (0.9L→1L, 9L→10L…) before encoding
    const normPack  = normalizeBirlaPackSize(pdfItem.packSize);
    const packCode  = packSizeToCode(normPack);
    if (!skuPrefix || !packCode) return base;

    const packFormatted = formatPackDisplay(normPack);
    const proposedSku   = skuPrefix + packCode;
    // Use the resolved Zoho category if present, else fall back to PDF category.
    const categoryForRouting = (zohoItem.category || zohoItem.zoho_category_name || pdfItem.category || '').toString();

    const proposedName = buildBirlaName({
        sku: proposedSku,
        pdfProduct: pdfItem.product,
        category: categoryForRouting,
        packFormatted,
    });

    if (!proposedName) return base;

    const brandDisplay        = BRAND_DISPLAY_NAMES[brandKey] || 'BIRLA OPUS';
    const proposedDescription = `${skuPrefix} ${currentCat} ${brandDisplay} ${packFormatted}`.replace(/\s+/g, ' ').trim();

    return { ...base, proposed_name: proposedName, proposed_sku: proposedSku, proposed_description: proposedDescription };
```

- [ ] **Step 4: Run integration tests, confirm pass**

Run: `npx jest tests/unit/dpl-naming.test.js -t "computeProposedFields"`

Expected: PASS, all 5 integration tests green.

- [ ] **Step 5: Run the full unit test suite to check for regressions**

Run: `npx jest tests/unit/`

Expected: ALL tests pass. If any pre-existing `price-list-parser`-related test asserts the old name format (`ESWT01 ESWT ...`), update its expectation to the new canonical form. If no pre-existing test fails, no edit needed.

- [ ] **Step 6: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-naming.test.js
git commit -m "feat(dpl): rewire computeProposedFields to canonical Birla Opus naming

Replaces the inline name template (which produced duplicate WT-prefixes
like 'ESWT01 ESWT EVER STAY ...') with buildBirlaName(). Emulsion rows
now strip the variant suffix; enamel rows preserve the color and insert
the ENAMEL keyword.

Spec: docs/superpowers/specs/2026-05-08-birla-opus-dpl-naming-design.md"
```

---

## Task 8: Manual acceptance check

**Files:** none (smoke test only)

- [ ] **Step 1: Pull latest server-side parser change to local & verify it parses**

Run: `node -e "require('./services/price-list-parser')"`

Expected: No error (module loads).

- [ ] **Step 2: Run the parser against a saved DPL PDF (sample) via Node REPL**

If the repo has a sample DPL PDF in `docs/audits/` or `public/temp/`, use it. Otherwise skip this step and rely on Step 3 production smoke check.

```bash
node -e "
const fs = require('fs');
const { parsePriceList, matchWithZohoItems, computeProposedFields, brandKeyFromName } = require('./services/price-list-parser');

(async () => {
    const path = process.argv[1] || 'docs/audits/birla-opus-sample.pdf';
    if (!fs.existsSync(path)) { console.log('No sample PDF — skipping'); return; }
    const buf = fs.readFileSync(path);
    const parsed = await parsePriceList(buf, path);
    console.log('Brand:', parsed.brand, 'Items:', parsed.totalExtracted);
    const sample = parsed.items.slice(0, 5);
    for (const it of sample) {
        const fake = { sku: 'ESWT01', category: it.category };
        const out = computeProposedFields(it, fake, brandKeyFromName(it.brand));
        console.log(out.proposed_name);
    }
})();
"
```

Expected: 5 lines printed, each matching the canonical format. No `ESWT ESWT` duplication.

- [ ] **Step 3: Production smoke test on `act.qcpaintshop.com`**

After deploying (out of scope for this plan — user will deploy via the standard `git pull && pm2 restart` flow), navigate to `https://act.qcpaintshop.com/admin-dpl.html`, upload a Birla Opus DPL PDF, click "Parse", and spot-check the review-table rows:

| Check | Expected |
|-------|----------|
| 5 emulsion rows | No duplicate SKU prefix; format `{SKU} {tier} {product} BIRLA OPUS {pack}` |
| 5 enamel rows | Color visible; format `{SKU} {product} ENAMEL {COLOR} BIRLA OPUS {pack}` |
| Pack zero-padding | `01 L`, `04 L`, `200 ML`, `500 ML` |
| Brand suffix | Always `BIRLA OPUS`, never just `OPUS` |

- [ ] **Step 4: If acceptance passes, no commit needed (no code change in this task)**

Mark the plan complete; close the plan file's TODO checkboxes.

If acceptance fails for any specific row, capture the row's PDF source line + expected vs. actual proposed_name, file a follow-up issue, and revisit Tasks 5-7 before considering the work done.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ ALL CAPS — covered by `.toUpperCase()` in `extractEmulsionProductName` and `extractEnamelProductAndColor`
- ✅ Brand always `BIRLA OPUS` — hardcoded in `buildBirlaName`
- ✅ Tier word kept — passes through emulsion product-name extraction unchanged
- ✅ Pack zero-padded — relies on existing `formatPackDisplay` (unchanged)
- ✅ No duplicate SKU prefix — `stripDuplicateSkuPrefix` covers (a) full SKU, (b) alpha-prefix run, (c) dangling unit
- ✅ Emulsion variant stripped — `extractEmulsionProductName` takes part before `" - "`
- ✅ Enamel color preserved with ENAMEL keyword — `buildBirlaName` enamel branch
- ✅ Other Birla categories deferred — non-enamel, non-emulsion falls back to emulsion format (deliberate; doesn't break Primer/etc., they already render fine via emulsion template)
- ✅ ANNEXURE edge case — handled in `extractEmulsionProductName` Step 3
- ✅ All 12 spec test items covered across Tasks 2-7

**Type consistency:**
- All helpers use plain string args; `buildBirlaName` accepts an object with named keys (`sku`, `pdfProduct`, `category`, `packFormatted`). Keys consistent across Task 6 and Task 7.
- `computeProposedFields` signature unchanged — still `(pdfItem, zohoItem, brandKey)`.

**Placeholder scan:** None.
