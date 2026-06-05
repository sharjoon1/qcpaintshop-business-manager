# DPL Catalog — Duplicate Zoho-link detection & best-match indication

Date: 2026-06-05
Status: approved (design)
Area: `public/admin-dpl.html` (DPL Catalog UI) + `services/dpl-catalog.js` (getCatalog)

## Problem

One Zoho item can end up **confirmed against more than one DPL catalog entry**
(e.g. the Zoho item `TF110 ONE TRUE FLEX BIRLA OPUS 10 L` linked to both the
"One True Flex White 10L" entry and a "Pastel base 10L" entry). A Zoho item
should map to exactly ONE DPL entry. `confirmLink` does not prevent this, so
collisions go unnoticed in the Confirmed view and a wrong entry can be pushed.

## Goal

In the catalog UI: detect when a Zoho item is shared by >1 entry, show a clear
indication, auto-hint which entry is the real match (via SKU), and offer a
one-click way to unlink the wrong one(s) (mark "Not in Zoho → pending").

## Scope

- **Detect** collisions among **confirmed** entries only (those are what push to
  Zoho). Entries with `zoho_item_id = NULL` are ignored.
- **No change** to `confirmLink` / build linker (auto-prevention is a separate
  future enhancement — out of scope, YAGNI).

## Design

### 1. Backend — enrich getCatalog (small)
`services/dpl-catalog.js::getCatalog(brand)` currently `SELECT *` from
`dpl_catalog`. Change to LEFT JOIN `zoho_items_map` so each linked entry carries
the real Zoho item identity:

```sql
SELECT d.*, z.zoho_sku AS zoho_sku, z.zoho_item_name AS zoho_name
FROM dpl_catalog d
LEFT JOIN zoho_items_map z ON z.zoho_item_id = d.zoho_item_id
WHERE d.brand = ?
ORDER BY d.category, d.product_name, d.base_name, d.size_tier
```

`zoho_sku` / `zoho_name` are null for unlinked entries. No new endpoint.

### 2. Detection + best-match (client, pure logic)
A pure helper, unit-testable:

```
computeDuplicateInfo(entries) -> {
  byZoho: Map<zoho_item_id, entryIds[]>,   // confirmed entries only, non-null id
  collisionIds: Set<entryId>,              // entries whose zoho_item_id is shared
  bestId: Map<zoho_item_id, entryId|null>  // the entry whose product_code matches zoho_sku
}
```

- Group **confirmed** entries by `zoho_item_id`; a group with ≥2 entries is a collision.
- **Best match** within a group: the entry whose DPL `product_code` matches the
  shared `zoho_sku` (normalized: upper-cased, compared as equality OR `zoho_sku`
  starts with `product_code`). If exactly one entry matches → that's `best`.
  If zero or more-than-one match → `best = null` (flag all, user decides).

### 3. UI (admin-dpl.html)
- **Row badge** on every collision entry: `⚠ Shared Zoho item (N)`.
- **Best-match tag**: the `best` entry → `✓ SKU match` (green); the others in the
  group → `✗ different product` (amber). When `best = null`, all show
  `⚠ ambiguous — check`.
- **Sub-filter chip** `⚠ Duplicates` next to the existing Confirmed push
  sub-filters (`confirmedSubFilter` row) — lists only collision entries.
- **Quick action**: show the existing `🚫 Not in Zoho` button on collision rows
  even when confirmed (today it is hidden for confirmed). Clicking it calls the
  existing `markNotInZoho(id, true)` → `setNotInZoho` already clears the link,
  sets `link_status='needs_creating'`, `not_in_zoho=1` (moves it to Pending).
  After the action, `loadCatalog()` reloads (selection now preserved by the
  earlier fix).

### Data flow
build/load → getCatalog (now with zoho_sku/zoho_name) → `catalogEntries` →
`computeDuplicateInfo` (memoised per render) → renderCatalog uses
`collisionIds`/`bestId` for badges, tags, sub-filter, and the quick button.

### Error handling / edge cases
- Unlinked entries (`zoho_item_id` null) never collide.
- A Zoho item with one entry → no badge.
- `product_code` missing → cannot be "best"; group becomes ambiguous.
- Marking the only-remaining duplicate as pending leaves the Zoho item unlinked
  (correct — it then shows under Needs-creating/Pending).

## Testing
- **Unit (jest):** extract `computeDuplicateInfo` into a tiny pure module (or a
  testable function) and cover: no collision; 2-way collision with one SKU
  match → correct best; ambiguous (no/2 matches) → best null; unlinked ignored;
  non-confirmed ignored.
- **Backend:** assert the new getCatalog query string includes the join + aliases
  (or a light query-shape test), consistent with existing dpl-catalog tests.
- **Manual:** on prod after deploy, the TF110 case shows the collision badge,
  marks White 10L as ✓ and Pastel 10L as ✗, and the quick "Not in Zoho" button
  moves Pastel to Pending.

## Correction (2026-06-05, post-review)

The first cut compared a DPL `product_code` prefix to `zoho_sku` — wrong for Birla,
which encodes the BASE in the SKU: **white=WT, pastel=1, mid=2, clear=99, yellow=5,
red=6**. So `TF110` = `TF`+`1`+`10` = **Pastel** 10L, NOT White. Best-match now uses
the server-computed `skuBaseMatch(entry)` (`services/dpl-catalog.js`): map the
entry's base NAME → base code(s), take the Zoho SKU stem via the existing
`zohoSkuStem` (size code stripped), and check the stem ends with the base code right
after the alphabetic product prefix. `getCatalog` annotates each linked Birla entry
with `sku_base_match` (true/false/null); the client picks best = the single group
member with `sku_base_match === true` (else ambiguous). Reuses the proven linker
helpers instead of re-deriving SKU structure on the client.

## Out of scope
- Preventing duplicate confirmation at link time.
- Auto-resolving collisions without user action.
- Non-Birla brands' SKU matching nuances (uses the same product_code↔sku compare).
