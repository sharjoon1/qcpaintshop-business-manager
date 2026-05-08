# Birla Opus DPL Price→Size Mapping Fix

**Status**: Approved 2026-05-08
**Scope**: Birla Opus DPL upload — restore correct price→size mapping in the AI parse path
**Touch points**: `routes/zoho.js` AI parse job (~lines 5025–5170)
**Out of scope**: Other brands, AI prompt refactor, enamel-specific Birla rules

## Goal

Fix the AI parse path so DPL prices are assigned to the correct pack sizes for Birla Opus emulsions. The user's complaint: "1L=₹490, 4L=₹1,930, 9L=₹4,783, 10L=₹9,478" for One Pure Elegance White — the 9L and 10L values are actually for 10L and 20L. The size labels are shifted because the AI cannot reliably infer the sparse column layout from the PDF text.

## Background — root cause

Birla Opus DPL PDFs have a fixed 9-column header (`200 ML 0.9L 1L 3.6L 4L 9L 10L 18L 20L`) but each product row only fills a subset of columns based on the variant base:

| Base | Number of prices | Real size mapping |
|------|------------------|-------------------|
| White | 4 | 1L, 4L, 10L, 20L |
| Pastel / Mid Tone | 5 | 200ml, 1L, 4L, 10L, 20L |
| Clear / Yellow / Red | 3 | 200ml, 1L, 4L |

The PDF text extraction (via `pdf-parse`) loses column alignment — empty cells disappear — so the parser sees only the present numbers in sequence. The AI-side prompt asks for explicit size labels per row, and the AI guesses wrong because it can't tell which columns are filled.

The traditional regex parser (`parseBirlaOpus` in `services/price-list-parser.js`) handles this correctly: it produces items with `_prices: number[]` arrays — the raw prices in row order — and defers size assignment to `matchWithZohoItems`, which uses Zoho's existing rates as ground truth (rate-anchored expansion at line 1100–1254).

But the AI parse job in `routes/zoho.js` flattens the traditional `_prices` arrays to flat rows using a fixed `TYPICAL_PACKS[i+2]` shift before merging with the AI output. This conversion forces wrong sizes (`1L, 4L, 9L, 10L` for any 4-price row) and bypasses the rate-anchored logic in `matchWithZohoItems`.

## Final fix

Restore the rate-anchored matching for Birla Opus by preserving the traditional parser's `_prices` arrays through to `matchWithZohoItems`. The function already handles both formats (rate-anchored for `_prices`, name-based for flat rows) — the AI parse path just needs to stop flattening.

### Code-level change

In `routes/zoho.js`, replace three blocks in the AI parse job:

#### 1. Step 5 — Strategy A traditional output (~lines 5025–5057)

Don't flatten `_prices` arrays via `TYPICAL_PACKS`. Push items with their `_prices` arrays preserved.

**Before** (broken):
```js
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

**After** (correct):
```js
for (const item of rawTrad) {
    const cat = TIER_TO_CAT[item.category] || item.category || '';
    if (Array.isArray(item._prices) && item._prices.length > 0) {
        // Preserve _prices array so matchWithZohoItems can do rate-anchored expansion
        // against Zoho catalog rates (line 1100-1254 in price-list-parser.js).
        tradRawItems.push({
            product: item.product,
            _prices: item._prices.slice(),
            category: cat,
            brand: detectedBrand,
            baseCode: item.baseCode,
        });
    } else if (item.dpl) {
        tradRawItems.push({
            product: item.product,
            packSize: item.packSize || '?',
            dpl: item.dpl,
            category: cat,
            brand: detectedBrand,
        });
    }
}
```

#### 2. Step 6 — Merge (~lines 5101–5116)

Replace the (product, packSize)-keyed flat-row merge with a two-pool approach. Traditional `_prices` items take priority; AI flat rows fill gaps for products traditional did not cover.

**Before**:
```js
const mergedMap = new Map();
const normKey = it => String(it.p || it.product || '').toUpperCase().replace(/\s+/g, ' ').trim() + '|' +
                       String(it.s || it.packSize || '').toUpperCase().replace(/\s+/g, '').trim();

for (const it of aiRawItems) {
    const k = normKey(it);
    if (k !== '|') mergedMap.set(k, it);
}
for (const it of tradRawItems) {
    const k = normKey(it);
    if (k !== '|' && !mergedMap.has(k)) mergedMap.set(k, it);
}
```

**After**:
```js
// Build set of products covered by traditional (with reliable _prices arrays).
const productKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const tradProductSet = new Set();
for (const it of tradRawItems) {
    const k = productKey(it.product);
    if (k) tradProductSet.add(k);
}

// Pool A: Traditional items (preferred). Includes both _prices and flat-dpl entries.
const mergedItems = tradRawItems.slice();

// Pool B: AI flat rows for products NOT covered by traditional.
for (const it of aiRawItems) {
    const k = productKey(it.p || it.product);
    if (!k) continue;
    if (tradProductSet.has(k)) continue; // traditional already covers this product
    mergedItems.push(it);
}
```

#### 3. Step 7 — Sanitize (~lines 5118–5137)

Update the sanitize loop to handle both `_prices` items and flat items (each item shape preserved).

**Before**:
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

**After**:
```js
const cleanItems = [];
for (const it of mergedItems) {
    if (!it || typeof it !== 'object') continue;
    const product  = fixDoubledName(String(it.p || it.product || '').trim());
    const category = String(it.c || it.category || '').toUpperCase().trim();
    if (!product) continue;

    // _prices items: preserve array for rate-anchored expansion in matchWithZohoItems
    if (Array.isArray(it._prices) && it._prices.length > 0) {
        const cleanedPrices = it._prices.filter(p => isFinite(p) && p > 0);
        if (cleanedPrices.length === 0) continue;
        cleanItems.push({
            product,
            _prices: cleanedPrices,
            category,
            brand: detectedBrand,
            baseCode: it.baseCode,
        });
        continue;
    }

    // Flat items (AI output or traditional non-emulsion): require explicit packSize + dpl
    const packSize = String(it.s || it.packSize || it.pack || '').trim();
    const dplNum   = parseFloat(it.d != null ? it.d : it.dpl);
    if (!packSize || !isFinite(dplNum) || dplNum <= 0) continue;
    cleanItems.push({ product, packSize, dpl: dplNum, category, brand: detectedBrand });
}
```

The downstream `matchWithZohoItems(cleanItems, zohoItems)` call is unchanged. The function already detects `_prices` arrays and runs rate-anchored expansion (price-list-parser.js:1122–1254).

## Tests

### Unit tests — new file `tests/unit/dpl-price-size.test.js`

Verify `matchWithZohoItems` correctly assigns `_prices` to sizes via Zoho rate ratios.

1. **Birla Opus White, 4 prices, 4-size Zoho family** → assigns ascending price to ascending Zoho rate
   - Input: `{ product: 'Calista Ever Stay - White', _prices: [490, 1930, 4783, 9478], category: 'INTERIOR EMULSION', brand: 'Birla Opus' }`
   - Zoho catalog: `[{ sku: 'ESWT01', rate: 635 }, { sku: 'ESWT04', rate: 2503 }, { sku: 'ESWT10', rate: 6203 }, { sku: 'ESWT20', rate: 12289 }]`
   - Expected: matched items show `1L→490, 4L→1930, 10L→4783, 20L→9478`

2. **Birla Opus Pastel, 5 prices, 5-size Zoho family** → 200ml gets the smallest price
   - Input: `_prices: [104, 484, 1902, 4740, 9390]`
   - Zoho catalog: `[ES12M, ES101, ES104, ES110, ES120]` with corresponding rates
   - Expected: `200ml→104, 1L→484, 4L→1902, 10L→4740, 20L→9390`

3. **Birla Opus Clear, 3 prices, 5-size Zoho family** → ascending prices map to ascending Zoho rates
   - Input: `_prices: [91, 418, 1643]`
   - Zoho catalog: 5 sizes with consistent rate ratios (200ml=118, 1L=541, 4L=2127, 10L=5276, 20L=10448)
   - Expected: 3 matched rows for 200ml/1L/4L; 10L and 20L Zoho items receive no price proposal (not in matched, not in unmatched — simply absent from the parse output)

4. **Flat row pass-through** — verify a non-_prices item still maps via name+packSize
5. **Mixed batch** — _prices items + flat items in one call → both paths produce correct output

### Integration smoke (manual after deploy)

Upload `BirlaOpus-DPL-Feb2026.pdf` (saved at `docs/audits/birla-opus-feb2026.pdf` for reference). Verify the AI Review screen shows:

| Product | Expected sizes & prices |
|---------|-------------------------|
| One Pure Elegance White | 1L=₹490, 4L=₹1,930, 10L=₹4,783, 20L=₹9,478 |
| One Pure Elegance Pastel | 200ml=₹104, 1L=₹484, 4L=₹1,902, 10L=₹4,740, 20L=₹9,390 |
| One Pure Elegance Mid Tone | 200ml=₹103, 1L=₹477, 4L=₹1,881, 10L=₹4,661, 20L=₹9,233 |
| One Pure Elegance Clear | 200ml=₹91, 1L=₹418, 4L=₹1,643 |

## Risks

| Risk | Mitigation |
|------|------------|
| Traditional parser misses some Birla products | AI flat rows fill via Pool B. Worst case: those rows keep current (wrong) AI sizes — no regression. |
| Zoho catalog has fewer sizes than PDF row | `matchWithZohoItems` skips smallest sizes via the `startIdx` while-loop (line 1221-1228) and reports leftover prices in `unmatched` with reason. |
| Two `_prices` items + AI flat item match the same Zoho item | Existing `bestByZohoId` dedup (line 1428–1450) keeps best match per Zoho ID. |
| Non-Birla brands | Unaffected. AI parse path's traditional+AI merge for non-Birla still flows through `parseBirlaOpus` (which won't match), producing zero `_prices` items. AI flat rows continue as before. |
| `_prices` items lacking a Zoho family match | Rate-anchored expansion has a fallback keyword scan (line 1144-1199). If still no match, item moves to `unmatched` with `_reject_reason`. |

## Acceptance criteria

1. All new unit tests pass.
2. Manual upload of the Feb 2026 Birla Opus DPL PDF produces correct sizes for the 4 products listed in the integration smoke table.
3. Other brands (Asian / Berger / Gem / JSW / Nippon) — no change in behavior.
4. AI parse job completes without timeout (rate-anchored expansion is O(n×m) for n parsed items × m Zoho items, same complexity as before).

## Migration

No DB migration. The change only affects how the AI parse job assigns sizes during DPL review. Existing `proposed_*` rows already saved are unaffected (this is a read-time correctness fix, not a write-time data change).
