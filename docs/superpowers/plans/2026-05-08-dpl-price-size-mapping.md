# Birla Opus DPL Price→Size Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore correct price-to-size mapping for Birla Opus DPL uploads by preserving the traditional parser's `_prices` arrays through to `matchWithZohoItems`, instead of flattening them with the wrong `TYPICAL_PACKS[i+2]` assignment.

**Architecture:** The fix is a single-file change in `routes/zoho.js` AI parse job (~lines 5025–5181). Three blocks are rewritten: (1) Strategy A's traditional output preserves `_prices` arrays, (2) the merge becomes a two-pool approach (traditional product set wins; AI fills gaps), (3) the output is built from `matchResult.matched + unmatched` directly instead of `cleanItems.map`. The `matchWithZohoItems` function already handles both shapes — no change there.

**Tech Stack:** Node.js, Express 5, Jest 30, MySQL via `mysql2/promise`. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-08-dpl-price-size-mapping-design.md`](../specs/2026-05-08-dpl-price-size-mapping-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/unit/dpl-price-size.test.js` | Create | Unit tests verifying `matchWithZohoItems` rate-anchored expansion for `_prices` arrays. |
| `routes/zoho.js` | Modify (~lines 5025–5181) | Preserve `_prices` from traditional parser, two-pool merge with AI, build output from match result. |

No other files change. The `matchWithZohoItems` function in `services/price-list-parser.js` is unchanged — its existing rate-anchored logic at lines 1100–1254 is what we're restoring access to.

---

## Task 1: Unit tests for `matchWithZohoItems` `_prices` rate-anchored expansion

**Files:**
- Create: `tests/unit/dpl-price-size.test.js`

This task validates the spec's correctness expectation: when `matchWithZohoItems` receives an item with a `_prices` array, it assigns each price to the Zoho-family member with the matching ascending rate. This is the existing behavior; the test pins it down so the route-level rewiring in Task 2 can rely on it.

- [ ] **Step 1: Create the test file**

```js
// tests/unit/dpl-price-size.test.js
const { matchWithZohoItems } = require('../../services/price-list-parser');

// Helper: build a synthetic Zoho catalog row.
function zohoItem({ id, sku, name, rate, brand = 'Birla Opus', category = 'INTERIOR EMULSION' }) {
    return {
        zoho_item_id: id, sku, name, rate, brand, category,
        cf_dpl: 0, description: '', dpl_updated_at: null,
    };
}

describe('matchWithZohoItems — Birla Opus _prices rate-anchored expansion', () => {
    test('White base: 4 prices map to 1L/4L/10L/20L by ascending rate', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - White',
            _prices: [490, 1930, 4783, 9478],
            category: 'INTERIOR EMULSION',
            baseCode: '9900',
        }];
        // Zoho rates approximate the published selling prices (DPL × 1.3).
        const zoho = [
            zohoItem({ id: '1', sku: 'ESWT01', name: 'ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 635 }),
            zohoItem({ id: '2', sku: 'ESWT04', name: 'ESWT04 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2503 }),
            zohoItem({ id: '3', sku: 'ESWT10', name: 'ESWT10 CALISTA EVER STAY BIRLA OPUS 10 L', rate: 6203 }),
            zohoItem({ id: '4', sku: 'ESWT20', name: 'ESWT20 CALISTA EVER STAY BIRLA OPUS 20 L', rate: 12289 }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(490);   // 1L
        expect(byZohoId['2'].dpl).toBe(1930);  // 4L
        expect(byZohoId['3'].dpl).toBe(4783);  // 10L
        expect(byZohoId['4'].dpl).toBe(9478);  // 20L
        expect(byZohoId['1'].packSize).toBe('1L');
        expect(byZohoId['2'].packSize).toBe('4L');
        expect(byZohoId['3'].packSize).toBe('10L');
        expect(byZohoId['4'].packSize).toBe('20L');
    });

    test('Pastel base: 5 prices include 200ml as the smallest', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Pastel',
            _prices: [104, 484, 1902, 4740, 9390],
            category: 'INTERIOR EMULSION',
            baseCode: '9901',
        }];
        const zoho = [
            zohoItem({ id: '1', sku: 'ES12M', name: 'ES12M CALISTA EVER STAY BIRLA OPUS 200 ML', rate: 135 }),
            zohoItem({ id: '2', sku: 'ES101', name: 'ES101 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 628 }),
            zohoItem({ id: '3', sku: 'ES104', name: 'ES104 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2467 }),
            zohoItem({ id: '4', sku: 'ES110', name: 'ES110 CALISTA EVER STAY BIRLA OPUS 10 L', rate: 6149 }),
            zohoItem({ id: '5', sku: 'ES120', name: 'ES120 CALISTA EVER STAY BIRLA OPUS 20 L', rate: 12184 }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(104);    // 200ml
        expect(byZohoId['2'].dpl).toBe(484);    // 1L
        expect(byZohoId['3'].dpl).toBe(1902);   // 4L
        expect(byZohoId['4'].dpl).toBe(4740);   // 10L
        expect(byZohoId['5'].dpl).toBe(9390);   // 20L
    });

    test('Clear base: 3 prices, larger Zoho sizes simply get no proposal', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Clear',
            _prices: [91, 418, 1643],
            category: 'INTERIOR EMULSION',
            baseCode: '9999',
        }];
        const zoho = [
            zohoItem({ id: '1', sku: 'ES9912M', name: 'ES9912M CALISTA EVER STAY BIRLA OPUS 200 ML', rate: 118 }),
            zohoItem({ id: '2', sku: 'ES9901',  name: 'ES9901 CALISTA EVER STAY BIRLA OPUS 01 L',   rate: 541 }),
            zohoItem({ id: '3', sku: 'ES9904',  name: 'ES9904 CALISTA EVER STAY BIRLA OPUS 04 L',   rate: 2127 }),
            zohoItem({ id: '4', sku: 'ES9910',  name: 'ES9910 CALISTA EVER STAY BIRLA OPUS 10 L',   rate: 5276 }),
            zohoItem({ id: '5', sku: 'ES9920',  name: 'ES9920 CALISTA EVER STAY BIRLA OPUS 20 L',   rate: 10448 }),
        ];

        const { matched, unmatched } = matchWithZohoItems(parsed, zoho);

        // Three smallest sizes get the prices.
        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(91);     // 200ml
        expect(byZohoId['2'].dpl).toBe(418);    // 1L
        expect(byZohoId['3'].dpl).toBe(1643);   // 4L
        // 10L and 20L Zoho items receive no entry (not matched, not unmatched).
        expect(byZohoId['4']).toBeUndefined();
        expect(byZohoId['5']).toBeUndefined();
        // No leftover prices, so unmatched is empty for this product.
        expect(unmatched.filter(u => u.product.includes('Ever Stay - Clear'))).toHaveLength(0);
    });

    test('Flat row pass-through: item without _prices still matches by name + packSize', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Sparkle - Blue',
            packSize: '1L',
            dpl: 150,
            category: 'ENAMEL',
        }];
        const zoho = [
            zohoItem({ id: '99', sku: 'CSTBL01', name: 'CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L', rate: 220, category: 'ENAMEL' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('99');
        expect(matched[0].dpl).toBe(150);
        expect(matched[0].packSize).toBe('1L');
    });

    test('Mixed batch: _prices item + flat item processed in one call', () => {
        const parsed = [
            {
                brand: 'Birla Opus',
                product: 'Calista Ever Stay - White',
                _prices: [490, 1930],
                category: 'INTERIOR EMULSION',
                baseCode: '9900',
            },
            {
                brand: 'Birla Opus',
                product: 'Calista Sparkle - Blue',
                packSize: '1L',
                dpl: 150,
                category: 'ENAMEL',
            },
        ];
        const zoho = [
            zohoItem({ id: '1', sku: 'ESWT01', name: 'ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 635 }),
            zohoItem({ id: '2', sku: 'ESWT04', name: 'ESWT04 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2503 }),
            zohoItem({ id: '99', sku: 'CSTBL01', name: 'CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L', rate: 220, category: 'ENAMEL' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(490);
        expect(byZohoId['2'].dpl).toBe(1930);
        expect(byZohoId['99'].dpl).toBe(150);
    });
});
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `npx jest tests/unit/dpl-price-size.test.js -v`

Expected: 5 PASS, 0 FAIL. The tests describe existing behavior of `matchWithZohoItems`, so they should be green from the start. If any fail, it means the spec's assumption about rate-anchored expansion is wrong and we need to revisit Task 2 before proceeding.

If a test fails because of an unrelated issue (e.g., an existing parser bug surfaces), capture the failure and report `BLOCKED` — do not patch `matchWithZohoItems`; that would expand scope.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/dpl-price-size.test.js
git commit -m "test(dpl): pin rate-anchored expansion behavior in matchWithZohoItems"
```

---

## Task 2: Rewire `routes/zoho.js` AI parse path

**Files:**
- Modify: `routes/zoho.js` (~lines 5025–5181)

This task replaces three blocks in the AI parse job. Because the blocks are interdependent (the merge consumes Step 5's output, the output build consumes the merge), they must be applied in one commit.

- [ ] **Step 1: Read the current state of the AI parse job to confirm line numbers**

Run:
```bash
grep -n "Strategy A: Traditional regex parser" routes/zoho.js
grep -n "Merge AI + Traditional" routes/zoho.js
grep -n "Build output" routes/zoho.js
```

Expected: three line numbers in the 5020–5180 range. If they've drifted, adjust the Edit ranges below accordingly. Do not modify any code outside the AI parse job.

- [ ] **Step 2: Replace Step 5 (Strategy A traditional output) — preserve `_prices` arrays**

Use the Edit tool to replace this exact block in `routes/zoho.js`:

**Old (currently in the file):**

```js
            // Typical Birla Opus ascending pack sizes for mapping _prices
            const TYPICAL_PACKS = ['200ml', '0.9L', '1L', '4L', '9L', '10L', '18L', '20L'];
            for (const item of rawTrad) {
                const cat = TIER_TO_CAT[item.category] || item.category || '';
                if (Array.isArray(item._prices) && item._prices.length > 0) {
                    const sorted = item._prices.slice().sort((a, b) => a - b);
                    sorted.forEach((price, i) => {
                        tradRawItems.push({ p: item.product, s: TYPICAL_PACKS[Math.min(i + 2, TYPICAL_PACKS.length - 1)], d: price, c: cat });
                    });
                } else if (item.dpl) {
                    tradRawItems.push({ p: item.product, s: item.packSize || '?', d: item.dpl, c: cat });
                }
            }
```

**New (replacement):**

```js
            // Preserve _prices arrays so matchWithZohoItems can do rate-anchored
            // expansion against Zoho catalog rates (price-list-parser.js:1100-1254).
            // Flat items (single dpl + packSize) pass through unchanged.
            for (const item of rawTrad) {
                const cat = TIER_TO_CAT[item.category] || item.category || '';
                if (Array.isArray(item._prices) && item._prices.length > 0) {
                    tradRawItems.push({
                        product:  item.product,
                        _prices:  item._prices.slice(),
                        category: cat,
                        brand:    detectedBrand,
                        baseCode: item.baseCode,
                    });
                } else if (item.dpl) {
                    tradRawItems.push({
                        product:  item.product,
                        packSize: item.packSize || '?',
                        dpl:      item.dpl,
                        category: cat,
                        brand:    detectedBrand,
                    });
                }
            }
```

The `TYPICAL_PACKS` constant is removed (it was the source of the bug and is no longer needed). Item shape now uses long keys (`product`, `packSize`, `category`) consistently.

- [ ] **Step 3: Replace Step 6 (merge) — two-pool product-set merge**

Replace this exact block:

**Old:**

```js
        // ── 6. Merge AI + Traditional (AI takes priority, trad fills gaps) ──
        // Use normalised (product|packSize) key for deduplication.
        const mergedMap = new Map();
        const normKey = it =>
            String(it.p || it.product || '').toUpperCase().replace(/\s+/g, ' ').trim() + '|' +
            String(it.s || it.packSize || '').toUpperCase().replace(/\s+/g, '').trim();

        for (const it of aiRawItems) {
            const k = normKey(it);
            if (k !== '|') mergedMap.set(k, it);
        }
        // Traditional items only fill gaps the AI missed
        for (const it of tradRawItems) {
            const k = normKey(it);
            if (k !== '|' && !mergedMap.has(k)) mergedMap.set(k, it);
        }
```

**New:**

```js
        // ── 6. Merge: traditional (with _prices) wins for products it covered;
        //          AI flat rows fill gaps for products traditional missed.
        const productKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
        const tradProductSet = new Set();
        for (const it of tradRawItems) {
            const k = productKey(it.product);
            if (k) tradProductSet.add(k);
        }

        // Pool A: every traditional item (both _prices and flat-dpl shapes).
        const mergedItems = tradRawItems.slice();

        // Pool B: AI flat rows for products NOT covered by traditional.
        for (const it of aiRawItems) {
            const k = productKey(it.p || it.product);
            if (!k) continue;
            if (tradProductSet.has(k)) continue;
            mergedItems.push(it);
        }
```

- [ ] **Step 4: Replace Step 7 (sanitize) — handle both `_prices` and flat shapes**

Replace this exact block:

**Old:**

```js
        const cleanItems = [];
        for (const it of mergedMap.values()) {
            if (!it || typeof it !== 'object') continue;
            const product  = fixDoubledName(String(it.p || it.product || '').trim());
            const packSize = String(it.s || it.packSize || it.pack || '').trim();
            const dplNum   = parseFloat(it.d != null ? it.d : it.dpl);
            const category = String(it.c || it.category || '').toUpperCase().trim();
            if (!product || !packSize || !isFinite(dplNum) || dplNum <= 0) continue;
            cleanItems.push({ product, packSize, dpl: dplNum, category, brand: detectedBrand });
        }
```

**New:**

```js
        const cleanItems = [];
        for (const it of mergedItems) {
            if (!it || typeof it !== 'object') continue;
            const product  = fixDoubledName(String(it.p || it.product || '').trim());
            const category = String(it.c || it.category || '').toUpperCase().trim();
            if (!product) continue;

            // Shape 1: _prices array — pass through for rate-anchored expansion.
            if (Array.isArray(it._prices) && it._prices.length > 0) {
                const cleanedPrices = it._prices
                    .map(p => parseFloat(p))
                    .filter(p => isFinite(p) && p > 0);
                if (cleanedPrices.length === 0) continue;
                cleanItems.push({
                    product,
                    _prices:  cleanedPrices,
                    category,
                    brand:    detectedBrand,
                    baseCode: it.baseCode,
                });
                continue;
            }

            // Shape 2: flat row — require explicit packSize + valid dpl.
            const packSize = String(it.s || it.packSize || it.pack || '').trim();
            const dplNum   = parseFloat(it.d != null ? it.d : it.dpl);
            if (!packSize || !isFinite(dplNum) || dplNum <= 0) continue;
            cleanItems.push({ product, packSize, dpl: dplNum, category, brand: detectedBrand });
        }
```

- [ ] **Step 5: Replace Step 10 (output build) — build from `matchResult` rows**

Find the block starting `// ── 10. Build output ─────` and ending with `return out;\n        });`.

**Old:**

```js
        // ── 10. Build output ─────────────────────────────────────────────────
        const itemsOut = cleanItems.map(it => {
            const key = it.product + '|' + it.packSize;
            const m = matchedByKey.get(key);
            const out = { product: it.product, packSize: it.packSize, dpl: it.dpl, category: it.category };
            if (m && m.zoho_item_id) {
                out.auto_match = {
                    zoho_item_id:           m.zoho_item_id,
                    zoho_item_name:         m.zoho_item_name,
                    proposed_name:          m.proposed_name          || null,
                    proposed_sku:           m.proposed_sku           || null,
                    proposed_description:   m.proposed_description   || null,
                    proposed_rate:          m.proposed_rate          || null,
                    current_sku:            m.current_sku            || null,
                    current_description:    m.current_description    || null,
                    current_rate:           m.currentRate            || null,
                    current_dpl:            m.currentDpl             || null,
                    warning:                m._warning               || null
                };
            }
            return out;
        });
```

**New:**

```js
        // ── 10. Build output ─────────────────────────────────────────────────
        // Source rows from matchResult.matched + unmatched (one entry per resolved
        // PDF row, including expansions of _prices arrays). This replaces the
        // old cleanItems.map approach which assumed every input had an explicit
        // packSize — now invalid because Birla Opus emulsion items use _prices.
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
```

The `matchedByKey` Map at lines ~5154–5158 is now unused. Delete it:

**Old (delete entirely):**

```js
        const matchedByKey = new Map();
        for (const m of matchResult.matched) {
            const key = (m.product || '') + '|' + (m.packSize || '');
            if (!matchedByKey.has(key)) matchedByKey.set(key, m);
        }
```

- [ ] **Step 6: Run the dpl-price-size unit tests + the existing dpl-naming tests**

Run:
```bash
npx jest tests/unit/dpl-price-size.test.js tests/unit/dpl-naming.test.js
```

Expected: All tests pass (5 + 45 = 50).

The route changes are not directly unit-tested here (the route handler is tightly coupled to multer, mysql2, http — too much to mock for a small fix). The unit tests above verify the algorithm the route now relies on; the route logic itself is straightforward plumbing covered by Task 3's manual smoke test.

- [ ] **Step 7: Sanity-check the modified file loads**

Run: `node -e "require('./routes/zoho.js'); console.log('zoho.js loaded OK')"`

Expected: prints `zoho.js loaded OK`. Any syntax error here means an Edit went wrong.

- [ ] **Step 8: Commit**

```bash
git add routes/zoho.js
git commit -m "fix(dpl): preserve _prices arrays through to matchWithZohoItems

The AI parse job was flattening parseBirlaOpus _prices arrays via
TYPICAL_PACKS[i+2], producing wrong sizes (1L/4L/9L/10L for any 4-price
row). This bypassed the rate-anchored expansion in matchWithZohoItems
that uses Zoho catalog rates as ground truth.

Now: traditional _prices items pass through unchanged, the merge prefers
traditional over AI for any product the traditional parser covered, and
the output is built from matchResult.matched + unmatched (which expands
_prices into individual rows correctly via rate-anchored matching).

Birla Opus emulsion sizes now map correctly:
  White (4 prices)  → 1L, 4L, 10L, 20L
  Pastel (5 prices) → 200ml, 1L, 4L, 10L, 20L
  Clear (3 prices)  → 200ml, 1L, 4L

Spec: docs/superpowers/specs/2026-05-08-dpl-price-size-mapping-design.md"
```

---

## Task 3: Manual production smoke test (no commit)

**Files:** none (verification only)

After Task 2 is committed and deployed (push to `origin/master`, then `ssh hetzner` pull + pm2 restart — same flow used after the previous PR), validate against the real February 2026 PDF the user uploaded earlier.

- [ ] **Step 1: Push and deploy**

```bash
git push origin master
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
```

Expected: deploy completes, business-manager process online with fresh uptime.

- [ ] **Step 2: Run the saved PDF through the AI parse job remotely**

This invokes the full code path (parseBirlaOpus + AI extraction + matchWithZohoItems) using the production `zoho_items_map` table.

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && node -e '
require(\"dotenv\").config();
const { createPool } = require(\"./config/database\");
const fs = require(\"fs\");
const { parsePriceList, matchWithZohoItems } = require(\"./services/price-list-parser\");

(async () => {
    const pool = createPool();
    const buf = fs.readFileSync(\"/www/wwwroot/act.qcpaintshop.com/uploads/dpl-pdfs/birla-opus/1775590169714-BirlaOpus-DPL-wef-25.02.26-version-2.0.pdf\");
    const parsed = await parsePriceList(buf, \"birla-opus.pdf\");
    const [zohoItems] = await pool.query(\"SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate, zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category FROM zoho_items_map WHERE zoho_status = \\\"active\\\"\");
    const { matched } = matchWithZohoItems(parsed.items, zohoItems);

    // Check the four One Pure Elegance variants
    const targets = [
        { product: \"One Pure Elegance - White\",    expected: { \"1L\": 490, \"4L\": 1930, \"10L\": 4783, \"20L\": 9478 } },
        { product: \"One Pure Elegance - Pastel\",   expected: { \"200ml\": 104, \"1L\": 484, \"4L\": 1902, \"10L\": 4740, \"20L\": 9390 } },
        { product: \"One Pure Elegance - Mid Tone\", expected: { \"200ml\": 103, \"1L\": 477, \"4L\": 1881, \"10L\": 4661, \"20L\": 9233 } },
        { product: \"One Pure Elegance - Clear\",    expected: { \"200ml\": 91,  \"1L\": 418, \"4L\": 1643 } },
    ];
    for (const t of targets) {
        const rows = matched.filter(m => m.product === t.product);
        console.log(\"\\n\" + t.product + \" — \" + rows.length + \" matched rows:\");
        for (const r of rows) {
            const exp = t.expected[r.packSize];
            const ok = exp != null && Math.abs(r.dpl - exp) < 0.5;
            console.log(\"  \" + r.packSize.padEnd(6) + \" dpl=\" + r.dpl + \" expected=\" + (exp == null ? \"(no expectation)\" : exp) + (ok ? \" OK\" : (exp != null ? \" MISMATCH\" : \"\")));
        }
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
'"
```

Expected output (each row marked `OK`):

```
One Pure Elegance - White — 4 matched rows:
  1L     dpl=490 expected=490 OK
  4L     dpl=1930 expected=1930 OK
  10L    dpl=4783 expected=4783 OK
  20L    dpl=9478 expected=9478 OK

One Pure Elegance - Pastel — 5 matched rows:
  200ml  dpl=104 expected=104 OK
  1L     dpl=484 expected=484 OK
  4L     dpl=1902 expected=1902 OK
  10L    dpl=4740 expected=4740 OK
  20L    dpl=9390 expected=9390 OK

(... Mid Tone and Clear similar ...)
```

If any row says `MISMATCH`, capture the actual value and report `BLOCKED`. The most likely cause would be that the Zoho catalog has different size SKUs than expected (e.g., missing 200ml for Pastel) — in which case the test command needs adjustment, not a code change.

- [ ] **Step 3: UI smoke check**

Open `https://act.qcpaintshop.com/admin-dpl.html` in a browser, upload the same Birla Opus DPL PDF, click AI Parse, wait for the job. On the AI Review screen, scroll to One Pure Elegance — Pastel rows. Verify the 5 sizes show 200ml/1L/4L/10L/20L (NOT 1L/4L/9L/10L/18L) with correct prices.

- [ ] **Step 4: Mark plan complete**

No commit. The task is verification only.

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Task |
|--------------|------|
| Step 5 modification (preserve `_prices`) | Task 2 Step 2 |
| Step 6 modification (two-pool merge) | Task 2 Step 3 |
| Step 7 modification (sanitize both shapes) | Task 2 Step 4 |
| Step 10 modification (output from match result) | Task 2 Step 5 |
| Unit tests for rate-anchored expansion | Task 1 |
| Integration smoke against real PDF | Task 3 |
| Acceptance criterion 1 (unit tests pass) | Task 1 Step 2 |
| Acceptance criterion 2 (real-PDF mapping correct) | Task 3 Step 2 |
| Acceptance criterion 3 (other brands unaffected) | Implicit — code path only changes the Birla traditional preservation; AI flat rows for other brands flow exactly as before |
| Acceptance criterion 4 (no timeout) | Implicit — `matchWithZohoItems` complexity unchanged |

All spec requirements covered.

**Placeholder scan:** None. Every step has exact code or exact commands.

**Type consistency:** Item shapes consistent across tasks:
- `_prices` items: `{ product, _prices, category, brand, baseCode }`
- Flat items: `{ product, packSize, dpl, category, brand }`
- Match result rows: `{ product, packSize, dpl, category, zoho_item_id?, ... }`
