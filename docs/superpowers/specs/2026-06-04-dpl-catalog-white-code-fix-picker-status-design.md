# DPL Catalog — fix White↔Clear SKU collision + picker link-status

**Date:** 2026-06-04
**Status:** Approved
**Scope:** `services/dpl-catalog.js` (multi-code base stems), `public/admin-dpl.html` (picker badge). Rebuild after deploy. No migration.

## Problem

1. **White wrongly matches Clear.** The linker maps the colour word `white → '99'` in SKU reconstruction. But on Birla Opus **`99` = Clear**, not White. Verified on prod: One Pure Elegance **Clear 1L → PE9901** AND **White 1L → PE9901** (the same Clear SKU); same for 4L → PE9904. So White stole Clear's item. This affects every emulsion with a `…99…` Clear SKU.
2. **No White match where the SKU uses a colour code.** Power Bright Shine encodes White as `WT` (`PBSWT04`), not a number. With `white → 99`, "PBS White" reconstructs to `pbs99` (no such SKU) → unmatched/ambiguous → review, "not linked", no recommendation.
3. **The re-pick picker doesn't show which Zoho items are already taken.** When picking, the user sees all `STYLE POWER BRIGHT SHINE` items (names carry no colour) and can't tell which are already confirmed to other catalog entries (e.g. PBSWT10 = 10L), making the right pick (PBSWT04 = 4L) hard.

## Decision (from brainstorming, corrected by user)

- **Remove `white → '99'`** (it's wrong — 99 is Clear). Clear keeps matching via its numeric base code "PE 99" (`pe99`, pure passthrough — no rule needed).
- **Map `white → ['wt','wht']`** (multi-code) so White matches SKUs that encode it (e.g. PBSWT). `dplBaseStem` returns multiple candidate stems; S1 confirms on a single hit across them.
- **Picker:** annotate each result with its catalog link status (confirmed/review + product·base·size).

## Architecture

### 1. Multi-code base stems (`services/dpl-catalog.js`)

Replace:
```javascript
const BASE_WORD_CODE = { white: '99' };
function dplBaseStem(baseCode) { ... returns one stem ... }
```
with:
```javascript
// Colour word → possible Zoho SKU base codes. NOTE: 99 = Clear on Birla Opus, NOT
// White — Clear matches via its numeric base ("PE 99" → "pe99") with no rule. White
// is encoded as WT/WHT in SKUs (e.g. PBSWT04). Numeric/unmapped bases pass through.
const BASE_WORD_CODE = { white: ['wt', 'wht'] };

// DPL baseCode ("PE White" / "PBS White" / "PE 1") → candidate Zoho SKU stems.
function dplBaseStems(baseCode) {
    const bc = String(baseCode == null ? '' : baseCode).trim().toLowerCase();
    if (!bc) return [];
    const m = bc.match(/^([a-z]+)\s+(.+)$/);
    if (!m) return [bc.replace(/[^a-z0-9]+/g, '')];
    const prefix = m[1];
    const baseRaw = m[2].replace(/\s+/g, '');
    const codes = BASE_WORD_CODE[baseRaw] || [baseRaw];   // word → list; else single passthrough
    return codes.map(c => prefix + String(c).replace(/[^a-z0-9]+/g, ''));
}
```

S1 in `linkEntryToZoho` becomes (matches if any candidate stem hits; unique hit confirms):
```javascript
const stems = dplBaseStems(entry.base_code);
if (stems.length && SIZE_CODE[entry.size_tier]) {
    const hits = items.filter(z => {
        const s = zohoSkuStem(z);
        return s && stems.includes(s.stem) && s.tier === entry.size_tier;
    });
    if (hits.length === 1) return { zoho_item_id: hits[0].zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'sku-reconstruct' };
    if (hits.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 55, link_reason: 'ambiguous-sku' };
}
```

Exports: replace `dplBaseStem` with `dplBaseStems`.

**Effect:** White (e.g. "PE White") → `pewt`/`pewht` → no PE white SKU → falls through (no longer steals PE9901); Clear ("PE 99") → `pe99` → PE9901 ✓; "PBS White" → `pbswt` → PBSWT04 ✓ (auto-confirm). Numeric bases (PE 1, PBS 1) unchanged.

### 2. Picker link-status badge (`public/admin-dpl.html`)

In `catPickerSearch`'s result render, add a per-result badge from the already-loaded `catalogEntries`:
```javascript
function catLinkBadge(zid) {
    var e = catalogEntries.find(function(x){ return x.zoho_item_id && String(x.zoho_item_id) === String(zid); });
    if (!e) return '';
    var label = (e.product_name || '') + ' · ' + (e.base_name || '') + ' · ' + (e.size_tier || '');
    if (e.link_status === 'confirmed') return '<div class="text-[10px] text-emerald-600 mt-0.5">✓ confirmed: ' + esc(label) + '</div>';
    return '<div class="text-[10px] text-amber-600 mt-0.5">⚠ in review: ' + esc(label) + '</div>';
}
```
Append `+ catLinkBadge(zid)` inside each result button. So the picker shows e.g. "PBSWT10 … ✓ confirmed: Style Power Bright Shine · White · 10L", and the free PBSWT04 shows no badge → the user picks it confidently.

## Non-goals

- No migration; no proposer/confirmLink/push change.
- Not adding colour codes beyond `white` (other word-bases pass through; extend later if needed).
- Not auto-creating Zoho items for genuinely-unmatched whites (stay needs_creating).

## Error handling

- `dplBaseStems` returns `[]` for empty baseCode (S1 skipped). Multiple-stem hits >1 → review-ambiguous (no false confirm).
- Picker badge: `find` returns the first linked entry; no entry → no badge.

## Testing

- Unit (`services/dpl-catalog.js`): `dplBaseStems('PE White')` → `['pewt','pewht']` (NOT pe99); `dplBaseStems('PE 99')` → `['pe99']`; `dplBaseStems('PBS White')` → `['pbswt','pbswht']`; `dplBaseStems('PE 1')` → `['pe1']`; empty → `[]`. `linkEntryToZoho` for a White entry + only a Clear PE9901 item → NOT confirmed to it (no `pewt` SKU); for "PBS White" 4L + PBSWT04 → confirmed sku-reconstruct. Update the existing `dplBaseStem`→`dplBaseStems` tests.
- Post-deploy: rebuild → OPE White 1L/4L NO LONGER linked to PE9901/PE9904 (they were wrong); Clear still PE9901/PE9904; Power Bright Shine White 4L → PBSWT04 confirmed. Picker for a PBS White entry shows the PBSWT10/20 as confirmed.

## Key files

- Modify: `services/dpl-catalog.js` (`BASE_WORD_CODE`, `dplBaseStems`, S1, exports), `tests/unit/dpl-catalog.test.js`, `public/admin-dpl.html` (`catLinkBadge` + picker render).
