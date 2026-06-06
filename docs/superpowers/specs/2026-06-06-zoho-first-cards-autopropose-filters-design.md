# Zoho-First View — Mobile Cards, Auto-Proposed DPL, Filters — Design

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan
**Area:** DPL Catalog Zoho-first view (`services/dpl-catalog.js`, `public/admin-dpl.html`)
**Builds on:** [[project-dpl-zoho-first-reconciliation-2026-06]] (the Zoho-first tab shipped 2026-06-06, HEAD `ac4d14a`).

---

## 1. Problem

The new Zoho-first reconciliation tab currently has only a desktop table and no
help for unmatched items — the user must open a picker and search the DPL list by
hand. The DPL-first view, by contrast, has mobile cards and a full filter bar. The
user wants the Zoho-first view brought to parity:

1. **Mobile cards** — one card per Zoho item on small screens (like DPL-first).
2. **Auto-proposed DPL match** — for each unmatched Zoho item, automatically suggest
   the best DPL candidate, with one-click Accept (no manual search needed).
3. **Filter options** — a filter chip bar (All / No match / Changed / Shared /
   Unchanged).

## 2. Goal

Extend the existing Zoho-first view (no change to its core data contract) with:

- A **mobile card** renderer (`#zohoFirstCards`, `sm:hidden`); the desktop table
  stays. Responsive parity with the DPL-first view.
- A **reverse matcher** that proposes the best unlinked DPL entry for each unmatched
  Zoho item, surfaced on the card/row with a **✓ Accept** action (reuses the
  existing `confirm-link` endpoint). Manual **Attach** picker remains as a fallback.
- A **filter chip bar** over the Zoho-first rows: All / ⚠ No match / ↕ Changed /
  ⚠ Shared / ✓ Unchanged, search-aware, with live counts.

**Non-goals:** No change to the rate formula, the push flow, the DPL-first view, the
`by-zoho` endpoint's request/response *shape* (only one new optional field per row),
or the `dpl_catalog` schema. Auto-propose **never auto-links** — it only suggests;
the user accepts.

## 3. Decisions (from brainstorming)

- **Auto-propose = Suggest + Accept.** The proposal is displayed; linking happens
  only when the user clicks Accept. Human stays in control.
- **Cards = mobile only.** Desktop keeps the table; mobile gets cards — exactly the
  DPL-first responsive pattern (`hidden sm:block` table + `sm:hidden` cards).
- **Filters = the full set:** All / ⚠ No match / ↕ Changed / ⚠ Shared / ✓ Unchanged.

## 4. Backend — `services/dpl-catalog.js`

### 4.1 New pure helper `proposeDplForZoho(zohoItem, unlinkedEntries)`

Reverse of `linkEntryToZoho`: given one active Zoho item and the brand's **unlinked**
DPL catalog entries, return the single best candidate, or `null`. Pure /
deterministic. Reuses the existing module-private primitives (`zohoSkuStem`,
`birlaBaseCodes`, `stemEndsWithCode`, `tokenize`, `hasAllTokens`,
`normalizeSizeTier`, `extractSizeFromZohoName`) — all callable directly since the
new function lives in the same module.

- **Inputs:**
  - `zohoItem`: `{ zoho_item_id, zoho_item_name, zoho_sku }`.
  - `unlinkedEntries`: array of `{ entry_id, product_name, base_name, size_tier,
    dpl_size_label, current_dpl, canonical_sku }` (the unlinked subset of
    `getCatalog(brand)`; note `size_tier` is added to this shape — see §4.2).
- **Strategy (first hit wins; `base_code` is NOT stored, so S1 uses `base_name`):**
  - **S0 — exact SKU (confidence `'high'`, reason `'exact-sku'`):** an entry whose
    `canonical_sku.toUpperCase() === zohoItem.zoho_sku.toUpperCase()`.
  - **S1 — SKU reconstruct (confidence `'high'`, reason `'sku-reconstruct'`):**
    `info = zohoSkuStem({ sku: zoho_sku, name: zoho_item_name })`; if `info`, the
    candidates are entries where `entry.size_tier === info.tier` AND
    `birlaBaseCodes(entry.base_name)` is non-null AND some code
    `stemEndsWithCode(info.stem, code)`. Exactly one candidate → propose it; more
    than one → ambiguous, no S1 proposal.
  - **S2 — name + tier (confidence `'low'`, reason `'product+tier-only'`):**
    `tier = normalizeSizeTier(extractSizeFromZohoName(zoho_item_name, zoho_sku))`;
    token set = `tokenize(zoho_item_name + ' ' + zoho_sku)`; candidates are entries
    where `hasAllTokens(tokenSet, tokenize(entry.product_name))` AND
    `entry.size_tier === tier`. Exactly one → propose; more than one → no proposal.
  - else `null`.
- **Returns** (or `null`): `{ entry_id, product_name, base_name, dpl_size_label,
  current_dpl, confidence, reason }`.

### 4.2 `buildZohoFirstView` changes

- Add `size_tier` to each object in `unlinkedEntries` (needed by the matcher; the
  attach picker ignores it).
- For each row with `status === 'unmatched'`, set `row.proposal =
  proposeDplForZoho(zohoItem, unlinkedEntries)` (else `proposal: null`). Matched /
  shared rows always carry `proposal: null`.
- Everything else (row fields, sort, counts) is unchanged.

The `GET …/:brand/by-zoho` endpoint is unchanged — it already returns
`buildZohoFirstView(...)`, so rows now carry `proposal` and `unlinkedEntries` carry
`size_tier` automatically.

## 5. Frontend — `public/admin-dpl.html` (Zoho-first view)

### 5.1 Filter bar

A chip row above the table/cards, mirroring DPL-first chip styling:

`All` · `⚠ No match` · `↕ Changed` · `⚠ Shared` · `✓ Unchanged`

- State: `zfFilter` (default `'all'`). `setZohoFilter(f)` sets it, restyles chips,
  re-renders.
- `visibleZohoFirstRows()` applies the filter + the existing `#zfSearch` text:
  - `all` → every row
  - `unmatched` → `status === 'unmatched'`
  - `changed` → `r.changed === true`
  - `shared` → `status === 'shared'`
  - `unchanged` → `status === 'matched' && !r.changed`
  - search: substring over `zoho_name` + `zoho_sku` (as today).
- `renderZohoFirst` renders `visibleZohoFirstRows()` into BOTH the table body and
  the cards; `#zfShowing` shows `visible/total`; the summary chips
  (`#zfTotal/#zfUnmatched/#zfChanged`) keep counting the full `zfRows`.

### 5.2 Mobile cards (`#zohoFirstCards`, `sm:hidden`)

One card per visible row:
- Header: `zoho_name` (bold, truncate) + status chip (reuse `zfStatusChip`).
- Body: `Current ₹old_dpl → New ₹new_dpl → Rate ₹new_rate` and a diff line
  (reuse `zfDiffCell` / `fmtMoney`); `—` where null.
- SKU sub-line (`zoho_sku`, mono).
- **Unmatched with proposal:** a highlighted block —
  `Proposed: <product_name> · <base_name> · <dpl_size_label> · ₹<current_dpl>`
  + a confidence tag (`high`/`low`) + reason — and two buttons: **✓ Accept**
  (`acceptProposal(zoho_item_id, entry_id)`) and **Attach…** (`openAttachPicker`).
- **Unmatched without proposal:** just **Attach…**.

The desktop table's Status cell gains, for unmatched rows **with** a proposal, a
compact **✓ Accept** button next to the existing **⚠ Attach DPL** (so desktop users
also get one-click accept). Tooltip shows the proposed item.

### 5.3 Accept action

`acceptProposal(zohoItemId, entryId)` → `POST
/api/zoho/items/dpl-catalog/entry/<entryId>/confirm-link` with `{ zoho_item_id }`
(the same call `attachDpl` makes) → toast → `loadZohoFirst()` to refresh. No new
endpoint.

### 5.4 Escaping / reuse

All API strings go through the page's existing `esc()` before `innerHTML`. Reuse
existing `getToken`/`showToast`/`fmtMoney`/`zfStatusChip`/`zfDiffCell`. New
functions (`setZohoFilter`, `visibleZohoFirstRows`, the card builder,
`acceptProposal`) live at the same top-level `<script>` scope (window-global) as
`renderZohoFirst`, for Playwright access.

## 6. Data flow

```
GET …/by-zoho → buildZohoFirstView (rows now carry .proposal for unmatched)
      │
renderZohoFirst → visibleZohoFirstRows() → table + cards
      │
unmatched card → ✓ Accept (proposal.entry_id) ─┐
              → Attach… (manual picker)         ├─→ confirm-link (existing) → reload
                                                 ┘
changed rows → existing "Push updated DPL" → push (existing)
```

## 7. Error handling

- `proposeDplForZoho` is pure and null-safe: missing/blank SKU or name simply
  reduces it to whichever strategies still apply (or `null`). Never throws, never
  returns a partial object.
- Accept/Attach reuse the existing endpoints' error handling; UI shows a toast and
  leaves state unchanged on failure.
- Empty filter result → the existing `#zohoFirstEmpty` empty-state (copy already
  distinguishes "no items for brand" vs "no match for search"; extend it to also
  cover an empty *filter* selection by keying off `visible.length`).

## 8. Testing

- **Unit (`tests/unit/dpl-catalog-zoho-first.test.js`, extend):**
  - `proposeDplForZoho`: S0 exact-SKU hit; S1 reconstruct hit; S1 ambiguous → null;
    S2 name+tier hit; S2 ambiguous → null; no-candidate → null; blank-SKU Zoho item
    falls through to S2; high vs low confidence labelling.
  - `buildZohoFirstView`: unmatched rows carry a `proposal` (or null); matched/shared
    rows carry `proposal: null`; `unlinkedEntries` now include `size_tier`.
- **E2E (`tests/e2e/admin-dpl-zoho-first.spec.js`, extend or sibling):** with a
  fixture row that has a `proposal`, assert the card/row renders a **✓ Accept**
  button; assert `setZohoFilter('unmatched')` narrows the rendered rows; assert the
  mobile cards container populates.

## 9. Isolation / boundaries

- `proposeDplForZoho` is a self-contained pure function; `buildZohoFirstView` gains
  one call to it. No DB, no clock — fully unit-testable.
- Frontend additions are scoped to the Zoho-first view; the DPL-first view, the
  endpoint shape, the push flow, and the schema are untouched.

## 10. Open items / future (out of scope for v1)

- "Accept all high-confidence proposals" bulk action (could follow once Accept is
  proven).
- Proposal for **shared** rows (choosing the right entry among several) stays with
  the existing DPL-first duplicate tools.
- Non-Birla brands: S1 depends on well-formed Birla SKUs; other brands fall back to
  S2 or no proposal until their scope/codes are added.
