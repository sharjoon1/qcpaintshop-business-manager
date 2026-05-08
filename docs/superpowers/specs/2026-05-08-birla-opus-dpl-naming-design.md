# Birla Opus DPL — Proposed-Name Naming Rules

**Status**: Approved 2026-05-08
**Scope**: Birla Opus emulsion + enamel proposed-name generation in DPL upload flow
**Touch points**: `services/price-list-parser.js::computeProposedFields()` only
**Out of scope**: Other brands (Asian/Berger/Gem/JSW/Nippon), other Birla categories (Primer/Wood/Construction/Colorant), bulk-rename of existing DB items

## Goal

Fix the Birla Opus proposed-name template in `computeProposedFields()` so DPL-upload review screens show item names that match the canonical naming convention used in the Zoho catalog. The user's primary complaint: SKU prefix appearing twice in the proposed name (e.g., `CSWT20 CSWT STYLE COLOR SMART BIRLA OPUS 20 L`). Secondary: enamel proposed names omit the color, even though enamel SKUs differentiate by color.

## Background — current behavior

`computeProposedFields()` at `services/price-list-parser.js:859` builds proposed Birla Opus names with this template:

```js
const secondToken = /WT$/i.test(skuPrefix) ? (' ' + skuPrefix) : '';
const proposedName = `${proposedSku}${secondToken} ${productNameBase} ${brandDisplay} ${packFormatted}`;
```

Two structural problems:

1. **`secondToken` duplicates the SKU prefix in the name** for every WT-base SKU. `ESWT01` produces `ESWT01 ESWT EVER STAY BIRLA OPUS 01 L`. The same bug already exists in many DB records (`CSWT20 CSWT STYLE COLOR SMART …`, `CSTSBK500ML CSTSBK500 ML …`, `AWPUEM01L AWPUEM01 L …`).
2. **`productNameBase` strips everything after `" - "`**. For emulsions this is correct — White/Pastel/Mid Tone are base variants encoded in the SKU number, so `Ever Stay - White` → `EVER STAY` is right. But for enamels (color-as-SKU), this drops the color, so `Calista Sparkle - Blue` → `CALISTA SPARKLE` and Blue is lost.

## Final rules

### Common (all categories)

- **Casing**: ALL CAPS
- **Brand suffix**: always `BIRLA OPUS` (never just `OPUS`)
- **Tier word kept**: `STYLE` / `CALISTA` / `ONE` retained from PDF product name
- **Pack format**: zero-padded — `NN L` for litres, `NNN ML` for ml, `NN KG` for kg (e.g., `01 L`, `04 L`, `20 L`, `200 ML`, `500 ML`, `01 KG`)
- **No duplicate SKU-prefix tokens** at the start of the name body

### Emulsion (Interior + Exterior)

```
{SKU} {PDF_PRODUCT_NAME_VARIANT_STRIPPED} BIRLA OPUS {PACK}
```

The product-name slot is the PDF product name with its variant suffix removed. Tier words (`STYLE` / `CALISTA` / `ONE`) are part of the PDF product name and pass through unchanged — there is no separate tier slot, and a product without a tier prefix simply has none in the output. Variant suffix (everything after `" - "` in the PDF product name) is stripped; base info is encoded in the SKU's middle digit (`WT`, `1`, `2`, `99`, `5`, `6`).

Examples:

| PDF input | Proposed name |
|-----------|---------------|
| `Ever Stay - White` + `ESWT01` + 1L | `ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L` |
| `Ever Stay - Pastel` + `ES101` + 1L | `ES101 CALISTA EVER STAY BIRLA OPUS 01 L` |
| `One Pure Elegance - Mid Tone` + `PE204` + 4L | `PE204 ONE PURE ELEGANCE BIRLA OPUS 04 L` |
| `Calista Sparkle - White` + `CSWT04` + 4L | `CSWT04 CALISTA SPARKLE BIRLA OPUS 04 L` |

### Enamel

```
{SKU} {PDF_PRODUCT_NAME_BEFORE_DASH} ENAMEL {COLOR} BIRLA OPUS {PACK}
```

The product-name slot is the PDF product name with the dashed color suffix removed (same as emulsion stripping, but the suffix is preserved separately as `COLOR`). The literal word `ENAMEL` sits between product name and color. If the PDF product name contains no `" - "` separator, `COLOR` is empty and the format collapses naturally (no double space).

Examples:

| PDF input | Proposed name |
|-----------|---------------|
| `Calista Sparkle - Blue` + `CSTBL01` + 1L | `CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L` |
| `Calista Sparkle - Deep Orange` + `CSTDOR01` + 1L | `CSTDOR01 CALISTA SPARKLE ENAMEL DEEP ORANGE BIRLA OPUS 01 L` |
| `Cover Max - White` + `CMEWT500` + 500ml | `CMEWT500 STYLE COVER MAX ENAMEL WHITE BIRLA OPUS 500 ML` |

### Other Birla Opus categories — DEFERRED

Primer, Distemper, Putty, Wood Polish, Construction Chemicals, Colorant — current DB pattern is too inconsistent to canonicalize from the 40-item sample. These pass through the existing template until we have a follow-up spec with focused samples.

## Architecture

Single-file change: `services/price-list-parser.js`.

### New helpers (same file, pure functions)

| Helper | Purpose |
|--------|---------|
| `stripDuplicateSkuPrefix(name, sku)` | Remove leading tokens of the name that duplicate the SKU. Implementation: derive `skuAlphaPrefix` (leading `[A-Z]+` of the SKU, e.g. `CSWT` from `CSWT20`); strip leading name tokens that (a) equal the full SKU exactly, (b) start with `skuAlphaPrefix` followed by digits, or (c) are dangling unit tokens (`L`, `ML`, `KG`) following such a strip. Stop once a token doesn't match. Handles `CSWT20 CSWT …`, `CSTSBK500ML CSTSBK500 ML …`, `AWPUEM01L AWPUEM01 L …`. |
| `isEmulsionCategory(cat)` | Returns true for `INTERIOR EMULSION` / `EXTERIOR EMULSION` (case-insensitive). |
| `isEnamelCategory(cat)` | Returns true for category text containing `ENAMEL`. |
| `extractEmulsionProductName(pdfProduct)` | Returns the part before `" - "`, ALL CAPS, trimmed. |
| `extractEnamelProductAndColor(pdfProduct)` | Returns `{ productName, color }` — split on `" - "`, both parts ALL CAPS. |
| `buildBirlaName({ sku, productName, color, category, packFormatted })` | Single template builder; routes to emulsion vs enamel format based on category. |

### Modified function

`computeProposedFields()` Birla Opus block calls `buildBirlaName()` instead of inline template. The `secondToken` line is removed entirely.

### Constant

`BRAND_DISPLAY_NAMES.birlaopus` already `'BIRLA OPUS'` — no change.

### UI

`admin-dpl.html` consumes `m.proposed_name` directly from `/dpl-match` response. No UI change required — fix surfaces automatically once parser update deploys.

## Data flow

```
PDF row
  → parsePriceList()                  (regex parser, brand-detected)
  → matchWithZohoItems()              (rate-anchored, base-aware)
  → computeProposedFields(pdf, zoho, brandKey)
       └─ buildBirlaName({...})        ← UPDATED
  → returned as m.proposed_name
  → admin-dpl.html review table
  → POST /dpl-apply on user confirm   (writes name to Zoho via cf_dpl flow)
```

Only `computeProposedFields()` and the new helpers change. The match algorithm, the apply step, and the UI are untouched.

## Error handling

| Case | Behavior |
|------|----------|
| Missing PDF product name | Fall through to `base` return (no `proposed_name`) — same as current |
| Missing SKU prefix or pack code | Fall through to `base` return — same as current |
| Category absent / unknown | Default to emulsion format (legacy fallback) |
| Variant suffix missing for enamel | Color = empty string; format collapses spaces (no `ENAMEL  BIRLA OPUS`) |
| `productName` is empty after stripping | Fall through to `base` return |

## Tests

New test file `tests/dpl-naming.test.js` (Node `assert`, integrated into `npm test`):

1. WT-base emulsion → no duplicate prefix: `ESWT01` + `Ever Stay - White` + `INTERIOR EMULSION` → `ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L`
2. Non-WT emulsion (Pastel base 1) → standard format: `ES101` + `Ever Stay - Pastel` → `ES101 CALISTA EVER STAY BIRLA OPUS 01 L`
3. Tier word retained — STYLE: `CF504` + `Style - Color Fresh` (or `Color Fresh`) → contains `STYLE COLOR FRESH`
4. Tier word retained — CALISTA: `EC601` + `Calista Ever Clear - Yellow` → `EC601 CALISTA EVER CLEAR BIRLA OPUS 01 L`
5. Tier word retained — ONE: `PE9901` + `One Pure Elegance - Clear` → `PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L`
6. Variant suffix stripped for emulsion → no `WHITE` / `PASTEL` / `MID TONE` / `YELLOW` / `RED` / `CLEAR` in output
7. Enamel color preserved: `CSTBL01` + `Calista Sparkle - Blue` + `ENAMEL` → `CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L`
8. Enamel multi-word color: `Calista Sparkle - Deep Orange` → contains `ENAMEL DEEP ORANGE`
9. Pack zero-padding: 1L → `01 L`, 4L → `04 L`, 20L → `20 L`, 200ml → `200 ML`, 500ml → `500 ML`
10. Brand always `BIRLA OPUS` (not `OPUS`)
11. Edge — empty product name → returns `base` without `proposed_name`
12. Edge — duplicate prefix already in PDF product name (rare): SKU `CSWT04` + product `CSWT04 Calista Sparkle` → `CSWT04 CALISTA SPARKLE BIRLA OPUS 04 L` (only one occurrence)

## Risks

- **`stripDuplicateSkuPrefix` edge cases**: SKUs that legitimately overlap with the start of a product name (rare, but possible). Mitigation: only strip leading tokens that exactly match the SKU's first 4-7 chars; leave anything ambiguous untouched.
- **Category detection wrong**: A Birla item whose `category` field is empty or non-standard would default to the emulsion format. This is acceptable — emulsion is the default Birla template.
- **Enamel without `" - "` separator**: Some enamel PDFs may name a product "Calista Sparkle Royal Ivory" without a dash. The split returns the entire string as productName and empty color. Output would be `... CALISTA SPARKLE ROYAL IVORY ENAMEL  BIRLA OPUS …` — extra space gets collapsed. Future improvement could detect known color words.

## Migration

No DB migration. The fix only affects newly-generated proposed names during DPL review. Existing Zoho items keep their current names (including the legacy duplicate-prefix records). A separate one-time bulk-rename script can canonicalize the legacy records later — out of scope for this spec.

## Acceptance criteria

1. All 12 unit tests pass.
2. Manual verification: upload one real Birla Opus DPL PDF (any month) → review screen → spot-check 5 emulsion rows + 5 enamel rows match the canonical format.
3. No regression in `dpl-apply` write path (proposed_name is the only changed field; SKU and rate logic untouched).
4. No regression in match accuracy — `matchWithZohoItems()` is not modified.
