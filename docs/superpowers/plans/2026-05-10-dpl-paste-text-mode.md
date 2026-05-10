# DPL Paste-Text Mode (Birla Opus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paste-text alternative to PDF upload on `admin-dpl.html` so admins can paste a tab-separated Birla Opus DPL table and run it through the same Zoho match/diff/push pipeline — bypassing PDF + AI extraction entirely.

**Architecture:** New deterministic parser `parseBirlaOpusTabular(text)` in `services/price-list-parser.js` produces flat `{ product, packSize, dpl, category, brand, baseCode }` rows. New synchronous endpoint `POST /api/zoho/items/parse-pasted-dpl` runs parser → existing `matchWithZohoItems` → returns the same response shape as the AI parse job's `data` field. Frontend gets a new "Paste Text" tab in Step 1 of `admin-dpl.html`; on success it feeds the response into the existing `aiData` slot and calls `showAiResults()` so the existing review/diff/push UI runs unchanged.

**Tech Stack:** Node.js + Express, vanilla JS frontend, Jest unit tests, MariaDB pool.

**Spec:** See `docs/superpowers/specs/2026-05-10-dpl-paste-text-mode-design.md`.

---

## File Touch List

- **Create:** `tests/unit/dpl-tabular-parser.test.js`
- **Modify:** `services/price-list-parser.js` (add `parseBirlaOpusTabular` + `normalizePackSize` helper, add to `module.exports`)
- **Modify:** `routes/zoho.js` (add new endpoint after the existing `/items/ai-parse-job/:id` block, before `/items/propose-naming`)
- **Modify:** `public/admin-dpl.html` (add Paste Text panel in Step 1 + `parsePastedText()` JS handler)

No DB migrations, no config changes, no new dependencies.

---

## Task 1: Tabular parser with TDD

**Files:**
- Create: `tests/unit/dpl-tabular-parser.test.js`
- Modify: `services/price-list-parser.js` (add `parseBirlaOpusTabular` near line 246 right after the existing `parseBirlaOpus` closes; add `normalizePackSize` helper near the top of the file with other helpers; export both at the bottom in the existing `module.exports` block at line ~1649)

### - [ ] Step 1: Write failing tests

Create `tests/unit/dpl-tabular-parser.test.js` with this content:

```javascript
const { parseBirlaOpusTabular, normalizePackSize } = require('../../services/price-list-parser');

describe('parseBirlaOpusTabular — exports', () => {
    test('parser is exported as a function', () => {
        expect(typeof parseBirlaOpusTabular).toBe('function');
    });
    test('normalizePackSize is exported', () => {
        expect(typeof normalizePackSize).toBe('function');
    });
});

describe('parseBirlaOpusTabular — happy path', () => {
    test('parses a single 6-column tab-separated row', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            product: 'One Pure Elegance - White',
            packSize: '1L',
            dpl: 490,
            category: 'Interior Luxury',
            brand: 'Birla Opus',
            baseCode: '941001',
        });
    });

    test('parses 2+ space-separated row when no tabs present', () => {
        const text = '1    Interior Luxury    One Pure Elegance (941001)    White    1L    490';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Pure Elegance - White');
        expect(out[0].dpl).toBe(490);
    });

    test('parses multiple rows', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '2\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930',
            '3\tInterior Luxury\tOne Pure Elegance (941001)\tPastel\t1L\t484',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(3);
        expect(out[0].packSize).toBe('1L');
        expect(out[1].packSize).toBe('4L');
        expect(out[1].dpl).toBe(1930);
        expect(out[2].product).toBe('One Pure Elegance - Pastel');
    });
});

describe('parseBirlaOpusTabular — shade inheritance', () => {
    test('5-column row inherits shade from previous row of same product', () => {
        const text = [
            '105\tInterior Premium\tCalista Ever Stay (942001)\tWhite\t4L\t864',
            '106\tInterior Premium\tCalista Ever Stay (942001)\t10L\t2,092',
            '107\tInterior Premium\tCalista Ever Stay (942001)\tWhite\t20L\t4,061',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(3);
        expect(out[0].product).toBe('Calista Ever Stay - White');
        expect(out[1].product).toBe('Calista Ever Stay - White'); // inherited
        expect(out[1].packSize).toBe('10L');
        expect(out[1].dpl).toBe(2092);
        expect(out[2].product).toBe('Calista Ever Stay - White');
    });

    test('5-column row with no prior shade falls back to product without dash', () => {
        const text = '50\tInterior Premium\tCalista Ever Stay (942001)\t10L\t2,092';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('Calista Ever Stay');
        expect(out[0].dpl).toBe(2092);
    });
});

describe('parseBirlaOpusTabular — price parsing', () => {
    test('strips comma thousands separator', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930';
        const out = parseBirlaOpusTabular(text);
        expect(out[0].dpl).toBe(1930);
    });

    test('rejects rows with zero or negative price', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t0';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(0);
    });

    test('rejects rows with non-numeric price', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\tTBD';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(0);
    });
});

describe('parseBirlaOpusTabular — header and trailer skipping', () => {
    test('skips the column-header row', () => {
        const text = [
            'S.No\tProduct Category\tProduct Name\tBase/Color Shade\tPack Size\tPrice (Excl. GST)',
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });

    test('terminates at "Terms and Conditions" line', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '',
            'Terms and Conditions- Dealer Price List for Retail Dealers',
            '1. This Dealer Price List is proprietary...',
            '2\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });
});

describe('parseBirlaOpusTabular — edge cases', () => {
    test('returns empty array for empty input', () => {
        expect(parseBirlaOpusTabular('')).toEqual([]);
        expect(parseBirlaOpusTabular(null)).toEqual([]);
        expect(parseBirlaOpusTabular(undefined)).toEqual([]);
        expect(parseBirlaOpusTabular('   \n\n  \n')).toEqual([]);
    });

    test('tolerates trailing whitespace on rows', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490   \t  ';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });

    test('"No Base/Others" shade produces product without dash-shade suffix', () => {
        const text = '369\tExterior Luxury\tOne Explore 15 Texture (930001)\tNo Base/Others\t25KG\t976';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Explore 15 Texture');
        expect(out[0].packSize).toBe('25kg');
    });

    test('parses product without (NNNNNN) SKU code (baseCode empty)', () => {
        const text = '87\tInterior Luxury\tOne Pure Legend\tPastel\t200ml\t126';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Pure Legend - Pastel');
        expect(out[0].baseCode).toBe('');
    });
});

describe('normalizePackSize', () => {
    test('1L stays 1L', () => {
        expect(normalizePackSize('1L')).toBe('1L');
    });
    test('25KG → 25kg', () => {
        expect(normalizePackSize('25KG')).toBe('25kg');
    });
    test('200ml stays 200ml', () => {
        expect(normalizePackSize('200ml')).toBe('200ml');
    });
    test('200ML → 200ml', () => {
        expect(normalizePackSize('200ML')).toBe('200ml');
    });
    test('0.9L stays 0.9L', () => {
        expect(normalizePackSize('0.9L')).toBe('0.9L');
    });
    test('0.5kg stays 0.5kg', () => {
        expect(normalizePackSize('0.5kg')).toBe('0.5kg');
    });
    test('whitespace tolerated', () => {
        expect(normalizePackSize(' 4L ')).toBe('4L');
    });
    test('non-numeric pack passes through unchanged', () => {
        expect(normalizePackSize('Per Unit')).toBe('Per Unit');
        expect(normalizePackSize('Sheet')).toBe('Sheet');
        expect(normalizePackSize('9"x11"')).toBe('9"x11"');
    });
    test('empty/null returns empty string', () => {
        expect(normalizePackSize('')).toBe('');
        expect(normalizePackSize(null)).toBe('');
        expect(normalizePackSize(undefined)).toBe('');
    });
});
```

### - [ ] Step 2: Run tests to verify they fail

Run: `npx jest tests/unit/dpl-tabular-parser.test.js`

Expected: All tests fail with `parseBirlaOpusTabular is not a function` (or similar import error).

### - [ ] Step 3: Add `normalizePackSize` helper to `services/price-list-parser.js`

Insert near the top of the file, **immediately before** the existing `function cleanPrice(...)` definition (search for `function cleanPrice` to find the right spot).

```javascript
/**
 * Normalize a pack-size string to a canonical form.
 * Examples: "1L"→"1L", "25KG"→"25kg", "200ML"→"200ml", "0.9L"→"0.9L".
 * Non-numeric pack sizes (e.g. "Per Unit", "Sheet", '9"x11"') pass through unchanged.
 */
function normalizePackSize(s) {
    if (s == null) return '';
    const trimmed = String(s).trim();
    if (!trimmed) return '';
    const m = trimmed.match(/^([\d.]+)\s*(L|ml|kg|gm|g)\s*$/i);
    if (m) {
        const val = m[1];
        const unit = m[2].toLowerCase();
        if (unit === 'l') return `${val}L`;
        return `${val}${unit}`;
    }
    return trimmed;
}
```

### - [ ] Step 4: Add `parseBirlaOpusTabular` to `services/price-list-parser.js`

Insert **immediately after** the existing `parseBirlaOpus` function closes (search for the last `return results; }` of `parseBirlaOpus` — around line 246 — and add this right after it):

```javascript
/**
 * Parse Birla Opus DPL data in tab-separated tabular format (paste-text mode).
 * Expected per-row columns: SNo, Category, Product (with optional "(NNNNNN)" code),
 * Shade, PackSize, Price. Some rows are 5-column (shade missing) — inherit from
 * the previous row for the same product.
 *
 * Returns flat rows compatible with `matchWithZohoItems`:
 *   { product, packSize, dpl, category, brand, baseCode }
 *
 * Where `product` is "<Product> - <Shade>" (matching the existing parseBirlaOpus
 * output convention, see line ~235), or just "<Product>" when shade is empty.
 */
function parseBirlaOpusTabular(text) {
    if (!text || typeof text !== 'string') return [];

    const results = [];
    const lines = text.split('\n');
    const lastShadeByProduct = new Map(); // productName → most recent shade

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, ''); // strip trailing whitespace only

        // Stop at T&C section.
        if (/^Terms\s+and\s+Conditions/i.test(line.trim())) break;

        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip column-header row.
        if (/^S\.?\s*No\b/i.test(trimmed)) continue;

        // Split on tabs first; if that yields < 5 fields, fall back to 2+ spaces.
        let cols = trimmed.split('\t').map(c => c.trim()).filter(c => c.length > 0);
        if (cols.length < 5) {
            cols = trimmed.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
        }
        if (cols.length < 5) continue;

        // First column must be a row number to be a data row.
        if (!/^\d+$/.test(cols[0])) continue;

        const category   = cols[1];
        const productRaw = cols[2];

        let shade, packSize, priceStr;
        if (cols.length >= 6) {
            shade    = cols[3];
            packSize = cols[4];
            priceStr = cols[5];
        } else {
            // 5-column row — shade missing.
            shade    = null;
            packSize = cols[3];
            priceStr = cols[4];
        }

        // Extract baseCode from "(NNNNNN)" if present.
        let productName = productRaw;
        let baseCode = '';
        const codeMatch = productRaw.match(/^(.+?)\s*\((\d{6})\)\s*\*?\s*$/);
        if (codeMatch) {
            productName = codeMatch[1].trim();
            baseCode = codeMatch[2];
        }

        // Resolve shade: inherit for 5-col rows; empty for "No Base/Others".
        if (shade === null) {
            shade = lastShadeByProduct.get(productName) || '';
        } else {
            shade = String(shade).trim();
            if (/^No\s+Base\s*\/\s*Others$/i.test(shade)) shade = '';
            if (shade) lastShadeByProduct.set(productName, shade);
        }

        const normalizedPack = normalizePackSize(packSize);
        if (!normalizedPack) continue;

        const dpl = parseFloat(String(priceStr).replace(/,/g, ''));
        if (!isFinite(dpl) || dpl <= 0) continue;

        const product = shade ? `${productName} - ${shade}` : productName;

        results.push({
            product,
            packSize: normalizedPack,
            dpl,
            category: category || '',
            brand: 'Birla Opus',
            baseCode,
        });
    }

    return results;
}
```

### - [ ] Step 5: Export the new functions

In `services/price-list-parser.js`, find the existing `module.exports = {` block (around line 1649) and add `parseBirlaOpusTabular` and `normalizePackSize` to the exports list. The existing exports include `parseBirlaOpus` — add the new names alongside it. The block should end up with both new entries:

```javascript
module.exports = {
    // ... existing exports unchanged ...
    parseBirlaOpus,
    parseBirlaOpusTabular,   // <-- add
    normalizePackSize,       // <-- add
    // ... rest unchanged ...
};
```

### - [ ] Step 6: Run tests to verify they pass

Run: `npx jest tests/unit/dpl-tabular-parser.test.js`

Expected: All tests pass. If any fail, fix the parser (don't change the test) and re-run.

### - [ ] Step 7: Commit

```bash
git add services/price-list-parser.js tests/unit/dpl-tabular-parser.test.js
git commit -m "$(cat <<'EOF'
feat(dpl): add parseBirlaOpusTabular for paste-text DPL ingest

New deterministic parser for tab-separated Birla Opus DPL tables (paste mode).
Emits flat rows compatible with matchWithZohoItems. Handles shade inheritance
for 5-column rows, comma thousands separators, header skip, T&C terminator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend endpoint

**Files:**
- Modify: `routes/zoho.js` (add new endpoint after the closing `});` of the existing `/items/ai-parse-job/:id` route handler — search for `_aiParseJobs.get(jobId)` to locate; insert before the next `router.<method>(...)` definition. Around line 5290 — anywhere between `/items/ai-parse-price-list` block and `/items/propose-naming` is fine.)

### - [ ] Step 1: Add the endpoint handler

Insert the following block in `routes/zoho.js` just before the existing `router.get('/items/propose-naming', ...)` route (search for `propose-naming` to find the spot):

```javascript
/**
 * POST /api/zoho/items/parse-pasted-dpl
 *
 * Synchronous Birla Opus DPL ingestion from pasted tab-separated text.
 * Skips PDF + AI extraction; uses the deterministic tabular parser, then
 * runs the same matchWithZohoItems pipeline as the PDF flow.
 *
 * Body: { brand: 'birlaopus', text: '<pasted-table>' }
 *
 * Returns the same `data` shape as /items/ai-parse-job/:id when status==='done'
 * so the frontend can plug it into the existing aiData / showAiResults flow.
 */
router.post('/items/parse-pasted-dpl', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.body && req.body.brand || '').toLowerCase().trim();
        const text  = String(req.body && req.body.text  || '');

        if (brand !== 'birlaopus') {
            return res.status(501).json({
                success: false,
                message: `Paste-text mode is only supported for Birla Opus right now. Use the PDF upload mode for "${brand || 'this brand'}".`
            });
        }
        if (!text.trim()) {
            return res.status(400).json({ success: false, message: 'No text provided' });
        }

        // 1. Parse pasted text → flat rows.
        const rawRows = priceListParser.parseBirlaOpusTabular(text);
        if (rawRows.length === 0) {
            return res.json({
                success: true,
                data: {
                    brand: 'birlaopus',
                    pages: 0,
                    totalExtracted: 0,
                    autoMatched: 0,
                    needsReview: 0,
                    items: [],
                    zohoItems: [],
                    source: { type: 'pasted-text', lines: text.split('\n').length, parsed: 0 },
                }
            });
        }

        // 2. Map paste-mode "Interior Luxury" / "Exterior Economy" / etc. to the
        //    canonical category names matchWithZohoItems / propose-naming expect.
        //    Mirrors TIER_TO_CAT in the AI flow but keyed off paste category strings.
        const PASTE_CAT_TO_CANON = {
            'INTERIOR LUXURY':       'INTERIOR EMULSION',
            'INTERIOR PREMIUM':      'INTERIOR EMULSION',
            'INTERIOR ECONOMY':      'INTERIOR EMULSION',
            'EXTERIOR LUXURY':       'EXTERIOR EMULSION',
            'EXTERIOR PREMIUM':      'EXTERIOR EMULSION',
            'EXTERIOR ECONOMY':      'EXTERIOR EMULSION',
            'WATERPROOFING':         'WATERPROOFING',
            'ENAMEL LUXURY':         'ENAMEL',
            'ENAMEL PREMIUM':        'ENAMEL',
            'ENAMEL ECONOMY':        'ENAMEL',
            'WOOD FINISHES LUXURY':  'WOOD FINISH',
            'WOOD FINISHES PREMIUM': 'WOOD FINISH',
            'WOOD FINISHES ECONOMY': 'WOOD FINISH',
            'WOOD FINISHES OTHER':   'WOOD FINISH',
            'PAINTING TOOLS':        '',
            'THINNERS':              '',
            'COLORANTS':             'COLORANT',
            'STAINERS':              'COLORANT',
        };
        const cleanItems = rawRows.map(r => ({
            product:  r.product,
            packSize: r.packSize,
            dpl:      r.dpl,
            category: PASTE_CAT_TO_CANON[String(r.category || '').toUpperCase().trim()] || r.category || '',
            brand:    r.brand,
            baseCode: r.baseCode,
        }));

        // 3. Fetch active Zoho items.
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                    zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                    zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                    dpl_updated_at
             FROM zoho_items_map
             WHERE zoho_status = 'active'
             ORDER BY zoho_item_name ASC`
        );

        // 4. Match.
        const matchResult = priceListParser.matchWithZohoItems(cleanItems, zohoItems);

        // 5. Build itemsOut (same shape as /items/ai-parse-job/:id done payload).
        const itemsOut = [];
        for (const m of matchResult.matched) {
            const out = {
                product:  m.product,
                packSize: m.packSize,
                dpl:      m.dpl,
                category: m.category,
            };
            if (m.zoho_item_id) {
                out.auto_match = {
                    zoho_item_id:         m.zoho_item_id,
                    zoho_item_name:       m.zoho_item_name,
                    proposed_name:        m.proposed_name        || null,
                    proposed_sku:         m.proposed_sku         || null,
                    proposed_description: m.proposed_description || null,
                    proposed_rate:        m.proposed_rate        || null,
                    current_sku:          m.current_sku          || null,
                    current_description:  m.current_description  || null,
                    current_rate:         m.currentRate          || null,
                    current_dpl:          m.currentDpl           || null,
                    warning:              m._warning             || null,
                };
            }
            itemsOut.push(out);
        }
        for (const u of matchResult.unmatched) {
            itemsOut.push({
                product:  u.product,
                packSize: u.packSize || '?',
                dpl:      u.dpl,
                category: u.category,
                unmatched_reason: u._reject_reason || null,
            });
        }

        // 6. Filter Zoho items to same brand (mirror PDF flow behavior).
        const pdfBrandNorm = priceListParser.normalizeBrand('Birla Opus');
        const sameBrandZoho = zohoItems.filter(z => {
            let zb = priceListParser.normalizeBrand(z.brand || '');
            if (!zb) {
                const nm = (z.name || '').toUpperCase();
                zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS' : '';
            }
            if (!zb) return true;
            return zb === pdfBrandNorm || zb.includes(pdfBrandNorm) || pdfBrandNorm.includes(zb);
        });

        const zohoItemsOut = sameBrandZoho.map(z => ({
            zoho_item_id: z.zoho_item_id,
            name:    z.name,
            sku:     z.sku,
            rate:    parseFloat(z.rate    || 0),
            cf_dpl:  parseFloat(z.cf_dpl  || 0),
            category:    z.category    || '',
            description: z.description || '',
            brand:       z.brand       || '',
            dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null
        }));

        return res.json({
            success: true,
            data: {
                brand:          'birlaopus',
                pages:          0,
                totalExtracted: itemsOut.length,
                autoMatched:    matchResult.matched.length,
                needsReview:    matchResult.unmatched.length,
                items:          itemsOut,
                zohoItems:      zohoItemsOut,
                source: {
                    type:   'pasted-text',
                    lines:  text.split('\n').length,
                    parsed: rawRows.length,
                },
            }
        });
    } catch (err) {
        console.error('parse-pasted-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});
```

### - [ ] Step 2: Smoke test the endpoint

Pre-req: server running locally (or via the user's dev environment). If not running, start it with `node server.js` (or `npm run dev` / `pm2 restart business-manager` depending on environment) — ask the user if uncertain.

Get an admin token from your local browser session (DevTools → Application → Local Storage → `auth_token`).

Run from PowerShell (replace `<TOKEN>`):

```powershell
$body = @{
    brand = 'birlaopus'
    text  = "1`tInterior Luxury`tOne Pure Elegance (941001)`tWhite`t1L`t490`n2`tInterior Luxury`tOne Pure Elegance (941001)`tWhite`t4L`t1,930"
} | ConvertTo-Json
curl -X POST http://localhost:3000/api/zoho/items/parse-pasted-dpl `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d $body
```

Expected response shape:
```json
{
  "success": true,
  "data": {
    "brand": "birlaopus",
    "totalExtracted": <some number ≥ 0>,
    "autoMatched":    <some number ≥ 0>,
    "needsReview":    <some number ≥ 0>,
    "items": [...],
    "zohoItems": [...],
    "source": { "type": "pasted-text", "lines": 2, "parsed": 2 }
  }
}
```

If the response is `{ success: true }` and arrays are present, the endpoint is wired correctly. If the user can't easily provide a token, skip this step and rely on Task 3 manual testing.

### - [ ] Step 3: Commit

```bash
git add routes/zoho.js
git commit -m "$(cat <<'EOF'
feat(dpl): add POST /api/zoho/items/parse-pasted-dpl endpoint

Synchronous endpoint for paste-text DPL ingest. Reuses matchWithZohoItems
and returns the same data shape as the AI parse job's done payload so the
frontend can feed it into the existing review/diff/push UI unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend Paste Text panel

**Files:**
- Modify: `public/admin-dpl.html`

The Step 1 area (lines ~100-231) contains: brand cards, dropzone, fileInfo, parse buttons, and the existing "Auto-Propose Naming (No PDF)" alternate-path block at lines ~209-230. We'll insert a new "Paste Text Mode" block immediately **before** the Auto-Propose block (so the visual order is: brand cards → PDF upload → Paste Text → Auto-Propose).

### - [ ] Step 1: Add the Paste Text panel HTML

In `public/admin-dpl.html`, find the comment `<!-- Auto-Propose (No PDF) — Step 0 / alternate path -->` (around line 209). **Immediately before that comment line**, insert this block:

```html
            <!-- Paste Text Mode — alternate input when PDF parsing is unreliable -->
            <div class="mt-4 border-t pt-4">
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div class="flex items-start gap-3 mb-3">
                        <svg class="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                        <div>
                            <div class="font-bold text-sm text-amber-800">Paste DPL Text (No PDF)</div>
                            <div class="text-[11px] text-amber-700 mt-0.5">Paste a tab-separated Birla Opus DPL table (same columns as the PDF: SNo, Category, Product, Shade, PackSize, Price). Bypasses PDF + AI extraction — deterministic and instant.</div>
                        </div>
                    </div>
                    <textarea id="pastedDplText" rows="8"
                              class="w-full text-[11px] font-mono px-3 py-2 border border-amber-300 rounded bg-white focus:border-amber-500 outline-none resize-y"
                              placeholder="1&#9;Interior Luxury&#9;One Pure Elegance (941001)&#9;White&#9;1L&#9;490&#10;2&#9;Interior Luxury&#9;One Pure Elegance (941001)&#9;White&#9;4L&#9;1,930&#10;..."
                              oninput="updatePastedDplLineCount()"></textarea>
                    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-3">
                        <div id="pastedDplLineCount" class="text-[11px] text-amber-700">Lines detected: 0</div>
                        <div class="flex items-center gap-2">
                            <select id="pastedDplBrand" class="px-2 py-1.5 border border-amber-300 rounded text-xs bg-white focus:border-amber-500 outline-none">
                                <option value="birlaopus">Birla Opus</option>
                            </select>
                            <button onclick="parsePastedText()" id="pastedDplBtn" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50">
                                <svg id="pastedDplSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                Parse Pasted Text
                            </button>
                        </div>
                    </div>
                </div>
            </div>

```

### - [ ] Step 2: Add the JS handler

Find the existing `function aiParsePDF()` definition (around line 637). Immediately **after** the closing `}` of `aiParsePDF` (and before the next function), add:

```javascript
    // ============ PASTE TEXT MODE ============
    function updatePastedDplLineCount() {
        const ta = document.getElementById('pastedDplText');
        const txt = ta && ta.value ? ta.value : '';
        const nonBlankLines = txt.split('\n').filter(l => l.trim().length > 0).length;
        const out = document.getElementById('pastedDplLineCount');
        if (out) out.textContent = 'Lines detected: ' + nonBlankLines;
    }

    async function parsePastedText() {
        const ta = document.getElementById('pastedDplText');
        const brandSel = document.getElementById('pastedDplBrand');
        const text = ta && ta.value ? ta.value : '';
        const brand = brandSel && brandSel.value ? brandSel.value : 'birlaopus';
        if (!text.trim()) {
            showToast('Paste some DPL text first', 'error');
            return;
        }
        const btn = document.getElementById('pastedDplBtn');
        const sp = document.getElementById('pastedDplSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        const statusEl = document.getElementById('parseStatus');
        if (statusEl) statusEl.textContent = 'Parsing pasted text...';
        try {
            const resp = await fetch('/api/zoho/items/parse-pasted-dpl', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ brand: brand, text: text })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(function(){ return {}; });
                throw new Error(err.message || ('Server error ' + resp.status));
            }
            const body = await resp.json();
            if (!body.success) throw new Error(body.message || 'Parse failed');
            // Plug response into the same state slot used by the AI flow,
            // then trigger the existing review UI.
            aiData = body.data;
            if (statusEl) statusEl.textContent = 'Parsed ' + (body.data.totalExtracted || 0) + ' rows from pasted text.';
            showAiResults();
        } catch (err) {
            showToast('Parse error: ' + err.message, 'error');
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }
```

### - [ ] Step 3: Restart dev server (if running) and manual test

If the user has a dev server running, ask them to restart it (`pm2 restart business-manager` on prod, or kill+restart the local node process). The HTML changes are static-served so a hard refresh (`Ctrl+F5`) is enough; the JS handler change requires the static file to be re-served (most setups handle this without a restart since `public/` is static).

Manual test in browser:
1. Navigate to `/admin-dpl.html`.
2. Click the "Birla Opus" brand card.
3. Scroll to the new amber "Paste DPL Text" panel.
4. Paste a few sample lines (e.g. the first 5 rows from the user's data).
5. Verify "Lines detected" updates as you type.
6. Click "Parse Pasted Text".
7. Expected: Step 2 (review UI) appears with auto-matched + needs-review counts; the items table is populated.

If the review UI doesn't appear, check the browser console for errors. Most likely failure modes:
- 401 → token issue, sign in again.
- 501 → brand mismatch, ensure `birlaopus` is selected.
- 500 → check server logs for parser/match errors.

### - [ ] Step 4: Commit

```bash
git add public/admin-dpl.html
git commit -m "$(cat <<'EOF'
feat(dpl): add Paste Text mode to admin-dpl.html

New amber panel in Step 1 lets admins paste a tab-separated Birla Opus DPL
table directly. Calls /api/zoho/items/parse-pasted-dpl synchronously and
plugs the response into aiData + showAiResults() so the existing review/
diff/push UI runs unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (after all tasks)

- [ ] All Jest tests pass: `npx jest tests/unit/dpl-tabular-parser.test.js` → green.
- [ ] Existing tests still pass: `npx jest` → green (or no new failures).
- [ ] `git log --oneline -5` shows three new commits: parser, endpoint, UI.
- [ ] Manual test in browser end-to-end: paste sample → Parse → review screen → confirm auto-matched count > 0 for known products.

## Self-Review Notes

- **Spec coverage:** All four sections of the spec (architecture, data format, components, tests) are covered: Task 1 = parser + tests, Task 2 = endpoint, Task 3 = frontend.
- **Type consistency:** `parseBirlaOpusTabular` returns `{ product, packSize, dpl, category, brand, baseCode }` — used identically in Task 1 (tests assert this), Task 2 (`cleanItems.map` preserves all fields), and the existing `matchWithZohoItems` (which only requires `product`, `packSize`, `dpl`, `category`, `brand`).
- **No placeholders.** All steps include exact code, exact file paths, exact commands.
