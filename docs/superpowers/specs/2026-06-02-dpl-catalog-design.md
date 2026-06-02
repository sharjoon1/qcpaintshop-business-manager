# Per-Brand DPL Catalog (Item-Master mediator) — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)
**Brand scope (v1):** Birla Opus only. Architecture must be extensible to Asian / Berger / Gem / JSW / Nippon later.

## Problem

The admin DPL flow (`admin-dpl.html`) parses a brand's Dealer Price List correctly, but **matching** DPL rows to existing Zoho items produces **wrong item matches** and **wrong price→size assignments**, and the user cannot reliably push correct names/categories/DPL prices to Zoho. The pain recurs on every DPL update.

## Root causes (from code analysis)

1. **The matcher ignores the clean parsed data.** `parseBirlaOpusTabular` reliably emits `{product, base, packSize, dpl, category, baseCode}` per row (30+ tests). But `matchWithZohoItems` was built for the lossy PDF path (`_prices` arrays with no sizes) and uses fuzzy heuristics on top of the clean rows:
   - **Price→size by rate-rank correlation** (`price-list-parser.js` ~1618-1657): prices are bound to Zoho items by sorting both lists ascending and matching by ordinal position — never by the actual `packSize`. Stale Zoho rates or a missing middle size shift every assignment.
   - **Hard pack-equality drops legitimate matches** (`packCode === pdfPack`): when the DPL lists a base at `900ml/3.6L/9L/18L` but Zoho stores it at `1L/4L/10L/20L`, the sizes don't equal, so the row is dropped or mismatched.
   - **Abbreviation-keyed pooling + weak keyword scoring + order-dependent tie-breaks** ("first match wins", non-deterministic across Zoho syncs).
   - **Permissive category gate** (`catCompatible` passes by default when either side lacks a category).
2. **Matches are ephemeral.** Every "Match Now" re-runs the fuzzy matcher from scratch and **forgets the user's corrections** — only `brand_dpl_lists` (raw text + parsed rows) is persisted, never the match result. The same wrong match recurs.
3. **Warnings are hidden in the main flow.** `_warning` (DPL > rate×1.5, < rate×0.25, fuzzy) is computed but **not rendered** in the AI review table.
4. **`item_naming_rules` exists but is unused.** The brand+product → `category_code`, `product_short`, `has_base`, `has_color` reference table is CRUD-managed in Item Master but never consulted by the matcher/proposer.

## Decisions (from brainstorming)

- **Approach: full item-master catalog first.** Build a canonical per-brand catalog (product × category × base/color × size), each entry linked to a Zoho item. DPL uploads then just refresh prices on the linked items.
- **Build from the DPL list, then link to Zoho.** Decompose the DPL into the catalog matrix; propose a canonical name/SKU per entry; suggest the best-match existing Zoho item; the user reviews/confirms **once**; confirmed links are pinned permanently.
- **`baseCode` (DPL product code) is the deterministic backbone key.**
- **Size-tier equivalence is mandatory.** The DPL may list some bases at "off" sizes while Zoho stores everything at "round" sizes. Match by **size tier**, never exact unit. Do NOT drop a product because units differ.
- **Missing Zoho items → flag only (v1).** Catalog entries with no Zoho match are marked `needs_creating`; no auto-create in v1.

## Architecture

A persistent **`dpl_catalog`** table mediates between the DPL price list and Zoho items. One row per canonical `(brand, product_code, base_name, size_tier)`.

### Size-tier equivalence (Birla Opus)

| `size_tier` (canonical = Zoho round size) | DPL labels that map to this tier |
|---|---|
| `200ml` | `200ml`, `200 ML` |
| `1L` | `1L`, `0.9L`, `900ml` |
| `4L` | `4L`, `3.6L` |
| `10L` | `10L`, `9L` |
| `20L` | `20L`, `18L` |

The normalizer lives in `services/dpl-catalog.js` as a per-brand map. The catalog stores the canonical `size_tier` **and** the DPL's actual `dpl_size_label` (for audit/display). A DPL `900ml` row's price is applied to the Zoho `1L`-tier item.

### `dpl_catalog` table

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AI | |
| `brand` | VARCHAR(40) | e.g. `birlaopus` |
| `category` | VARCHAR(120) | from DPL, e.g. `Interior Luxury` |
| `product_code` | VARCHAR(20) | DPL 6-digit code (e.g. `941001`); `''` if the DPL row has none |
| `product_name` | VARCHAR(160) | e.g. `One Pure Elegance` |
| `base_name` | VARCHAR(80) | shade/base, e.g. `White`, `Base 2`; `''` when none |
| `size_tier` | VARCHAR(12) | canonical Zoho size: `200ml`/`1L`/`4L`/`10L`/`20L` |
| `dpl_size_label` | VARCHAR(20) | DPL's actual label for this entry, e.g. `900ml` |
| `zoho_item_id` | VARCHAR(40) NULL | pinned push target; NULL = `needs_creating` |
| `canonical_name` | VARCHAR(255) | generated |
| `canonical_sku` | VARCHAR(64) | generated |
| `canonical_description` | VARCHAR(255) | generated |
| `current_dpl` | DECIMAL(12,2) NULL | latest DPL |
| `current_rate` | DECIMAL(12,2) NULL | latest selling rate = `ceil(dpl×1.298)` |
| `link_status` | ENUM(`confirmed`,`review`,`needs_creating`) | |
| `link_confidence` | TINYINT NULL | 0-100, from the linker |
| `link_reason` | VARCHAR(120) NULL | e.g. `exact-sku`, `product+base+tier`, `fuzzy` |
| `updated_by` | INT NULL | |
| `created_at`,`updated_at` | TIMESTAMP | |

**Row identity = a single `match_key` column** (the only UNIQUE index; avoids NULL/empty-string pitfalls of composite unique keys):

- `match_key` VARCHAR(255) UNIQUE — built as `lower(brand | code-or-slug | base_name | size_tier)` joined by `|`, where `code-or-slug` = `product_code` when present, else a lowercased alphanumeric slug of `product_name`. The four source columns (`brand`, `product_code`, `product_name`/its slug, `base_name`, `size_tier`) are stored for querying/display, but uniqueness and all upserts key off `match_key` alone.

`normalizeSizeTier` is applied before composing the key, so the same product+base at `900ml` (DPL) and `1L` (canonical) resolve to the SAME `match_key`.

### Component breakdown (isolated units)

| Unit | Responsibility | Depends on |
|---|---|---|
| `services/dpl-catalog.js` (new) | catalog CRUD; `normalizeSizeTier(brand,label)`; `buildCatalogFromDpl(brand, parsedRows, zohoItems)`; `linkEntryToZoho(entry, zohoItems)`; `applyDplPrices(brand, parsedRows)`. `setPool` injection like other services. | pool, `price-list-parser` naming helpers |
| Size-tier map | per-brand label→tier table inside `dpl-catalog.js` | — |
| Canonical name/SKU generator | reuse `buildBirlaName` + `item_naming_rules` lookup | `price-list-parser.js`, `item_naming_rules` |
| Catalog review UI | new "Catalog" state in `admin-dpl.html` | existing fetch/render helpers |
| Endpoints in `routes/zoho.js` | build, get, confirm-link, update-prices | `dpl-catalog.js`, `bulk-edit` |

**Reused unchanged:** `parseBirlaOpusTabular`, `brand_dpl_lists` storage, the `bulk-edit` push path (`cf_dpl`/`purchase_rate`/`rate`/name/sku → `custom_fields` wrapping → background worker), the pricing formula `ceil(DPL × 1.18 × 1.10)`, and `dpl_price_history` logging.

## Phase 1 — Build catalog + one-time link review (per brand)

1. **Save DPL** — existing `brand_dpl_lists` save flow (paste → `parseBirlaOpusTabular` → store).
2. **Decompose** — read `parsed_rows` from `brand_dpl_lists`.
3. **Normalize size-tier** — `normalizeSizeTier('birlaopus', row.packSize)` → `size_tier`; keep `row.packSize` as `dpl_size_label`. Unknown labels → keep verbatim as their own tier + flag `review`.
4. **Group** into catalog entries by `match_key`. (Multiple DPL rows can never collide on a key after tier normalization unless the DPL itself duplicates a product+base+size — in which case the later row wins and a `review` flag is set.)
5. **Generate canonical name/SKU/description** per entry via `buildBirlaName` + `item_naming_rules` (category_code, product_short, base/color).
6. **Link to Zoho** — `linkEntryToZoho(entry, scopedZohoItems)` runs strategies in order, stopping at the first hit:
   - **S1 exact-SKU**: `canonical_sku` === a Zoho `sku` → `confidence=100`, `reason=exact-sku`.
   - **S2 product+base+size-tier composite**: Zoho items whose parsed (product, base, **tier**) equals the entry's. Tier is derived from the Zoho item's own size via the SAME `normalizeSizeTier`. Exactly one → `confidence=90`, `reason=product+base+tier`. (This is what fixes the 900ml↔1L case: the DPL `900ml` entry normalizes to `1L` tier and matches the Zoho `1L` item.)
   - **S3 fuzzy fallback**: best keyword+base score over the scoped family; emit `confidence` = score-derived (≤70), `reason=fuzzy`, `link_status=review`.
   - No candidate → `zoho_item_id=NULL`, `link_status=needs_creating`.
   Every entry gets a `link_status`: `confirmed` only for S1/S2 single-hit; `review` for fuzzy/ambiguous; `needs_creating` for none.
7. **Persist** all entries (upsert by `match_key`). S1/S2 unambiguous entries may be pre-marked `confirmed`; everything else `review`/`needs_creating`.
8. **Review UI** (`admin-dpl.html` Catalog state): product-grouped table. Each entry shows: `category · product · base · size_tier (dpl_size_label) · DPL · proposed name/SKU · suggested Zoho item + confidence% + reason · [✓ confirm | 🔄 re-pick (Zoho picker) | ➕ needs-creating]`. Low confidence and any DPL>rate×1.5 / DPL<rate×0.25 warnings are visually flagged. Bulk "confirm all ≥90%" affordance. On confirm/re-pick, the entry's `zoho_item_id` + `link_status=confirmed` are saved.

## Phase 2 — DPL price update + push (every future DPL)

1. **Paste new DPL** → `parseBirlaOpusTabular` → rows.
2. **Re-key** each row to a catalog entry by `match_key` (after size-tier normalization). `applyDplPrices`:
   - Entry found → update `current_dpl`, recompute `current_rate = ceil(dpl×1.298)`. **No fuzzy, no re-match.**
   - `match_key` not in catalog → collect as **`new — needs linking`** (routed to a Phase-1 mini-review for just these).
   - Catalog entries with **no DPL row this time** → listed as **"no DPL update in this list"** (explicit, not silent).
3. **Diff view** — per linked Zoho item: old DPL/rate → new DPL/rate, name/sku/category change (if canonical differs from Zoho). Warnings flagged.
4. **Push** — selected entries → existing `bulk-edit`: `cf_dpl=dpl`, `purchase_rate=dpl`, `rate=current_rate`, and `name/sku/description/category` only when the canonical value differs from the current Zoho value. Background worker writes to Zoho; `dpl_price_history` logs the change.

## Canonical naming & pricing (reused, made authoritative)

- **Name/SKU**: `buildBirlaName` template + `item_naming_rules` (`category_code`, `product_short`, `has_base`, `has_color`). Where a rule is missing for a (brand, product), fall back to today's `buildBirlaName` heuristic and flag the entry so the user can add the naming rule.
- **Pricing**: `purchase_rate = DPL`, `rate = Math.ceil(DPL × 1.18 × 1.10)` (= `ceil(DPL × 1.298)`), unchanged from `computeProposedFields`.

## Error handling

- Unknown size label → entry flagged `review` with `dpl_size_label` preserved; never silently dropped.
- Ambiguous S2 (multiple Zoho items same product+base+tier) → `review`, all candidates offered in the picker.
- Catalog build is idempotent (upsert by `match_key`); re-running never duplicates rows.
- Push reuses the existing duplicate-SKU guard and the deferred-SKU local write.
- All catalog writes audit-logged (`dpl_catalog.build`, `dpl_catalog.link.confirm`, `dpl_catalog.prices.apply`).

## Testing

- **Unit (`services/dpl-catalog.js`)**: `normalizeSizeTier` (200ml/900ml→1L/3.6L→4L/9L→10L/18L→20L/unknown); `buildCatalogFromDpl` grouping + tier normalization; `linkEntryToZoho` S1/S2/S3/none with the 900ml↔1L case explicitly; `applyDplPrices` (found / new-needs-linking / no-DPL-this-time).
- **Integration**: build catalog from a real Birla tabular paste against a mock Zoho set that stores all bases at round sizes; assert the off-size DPL bases link to the round-size Zoho items.
- **Regression**: existing `dpl-tabular-parser`, `dpl-naming`, `dpl-price-size` suites stay green; the legacy `matchWithZohoItems` path is untouched (catalog is an additive flow).

## Out of scope (v1, YAGNI)

- Auto-creating missing Zoho items (flag only).
- Brands other than Birla Opus (extensible design, not built).
- Rewriting/removing the legacy `matchWithZohoItems` fuzzy flow — the catalog is a new, parallel path; the old flow can be retired in a later pass once the catalog is trusted.
- PDF parsing path (the user pastes tabular text).

## Implementation decomposition (for the plan)

1. **Data model + service**: `dpl_catalog` migration; `services/dpl-catalog.js` (size-tier, build, linker, apply-prices) with unit tests. (No UI.)
2. **Build + review API + UI**: endpoints (build, get, confirm-link) + the `admin-dpl.html` Catalog review state.
3. **Update + push flow**: `applyDplPrices` endpoint + diff view + wire into existing `bulk-edit` push.

Each sub-plan produces working, testable software on its own.

## Key files

- New: `migrations/migrate-dpl-catalog.js`, `services/dpl-catalog.js`, tests `tests/unit/dpl-catalog.test.js`.
- Modified: `routes/zoho.js` (new catalog endpoints), `public/admin-dpl.html` (Catalog state/tab).
- Reused: `services/price-list-parser.js` (`parseBirlaOpusTabular`, `buildBirlaName`, helpers), `brand_dpl_lists`, `item_naming_rules`, `bulk-edit`, `dpl_price_history`.
