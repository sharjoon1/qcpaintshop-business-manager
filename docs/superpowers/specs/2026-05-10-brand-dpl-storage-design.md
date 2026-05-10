# Brand DPL Storage + Re-match (Birla Opus) Design

**Date:** 2026-05-10
**Status:** Approved (brainstorming complete)
**Scope:** Persist a brand's DPL price list in DB so admins set it once and re-match against Zoho catalog any time without re-pasting.

## Background

The just-shipped paste-text mode (`docs/superpowers/specs/2026-05-10-dpl-paste-text-mode-design.md`) treats pasted DPL data as ephemeral input — admin pastes, parses, reviews, pushes, and the data is forgotten. Every Zoho catalog change requires re-pasting the same DPL text.

The user wants the pasted DPL to **become the brand's stored reference price list**. After the initial paste, future Zoho-side changes (new SKUs added, naming rules updated) trigger a "Match Now" action that runs against the stored DPL — no re-paste.

## Goals

1. Store one DPL price list per brand, persistently in DB.
2. On brand select in `admin-dpl.html`, show summary if saved (rows, effective date, last update); show paste UI if not.
3. "Match Now" runs `matchWithZohoItems` against stored data and feeds the existing review UI.
4. "Update DPL" lets admin replace the stored text + parse + match in one click.
5. Pasted text is parsed once at save time; matching reads pre-parsed JSON, no re-parsing on every match.

## Non-Goals

- Other brands (Asian/Berger/JSW/Nippon) — table is multi-brand-ready; only Birla Opus parser supported in v1.
- DPL history — only the current price list is retained. Update = REPLACE.
- Automatic effective-date scheduling — admin enters date manually; defaults to today.
- Changes to `matchWithZohoItems`, `buildBirlaName`, or push-to-Zoho logic.

## Architecture

```
admin-dpl.html
  ├── Step 1: Brand select          (unchanged)
  │     └── On click: loadBrandDplState(brand)
  │           ├── GET /api/zoho/items/brand-dpl/:brand
  │           │     ├── 200 → render Saved Summary Card
  │           │     │           ├── [Match Now]   → POST .../match → aiData + showAiResults()
  │           │     │           └── [Update DPL]  → fetch raw_text, swap to paste UI
  │           │     └── 404 → render Paste UI
  │           └── Paste UI → POST .../:brand → save + match → aiData + showAiResults()
  ├── Step 2: Review/Diff           (unchanged — fed via aiData)
  ├── Step 3: Approve               (unchanged)
  └── Step 4: Push to Zoho          (unchanged)
```

**Replaces** the just-built `POST /api/zoho/items/parse-pasted-dpl`. That endpoint is deleted.

The `parseBirlaOpusTabular(text)` parser (introduced 2026-05-10) is reused unchanged; this work is purely a persistence + UI layer on top of it.

## Data Model

### Table `brand_dpl_lists`

Single row per brand. Update via `INSERT ... ON DUPLICATE KEY UPDATE`.

```sql
CREATE TABLE brand_dpl_lists (
    brand           VARCHAR(50)   NOT NULL,
    raw_text        MEDIUMTEXT    NOT NULL,
    parsed_rows     JSON          NOT NULL,
    parsed_count    INT           NOT NULL,
    effective_date  DATE          DEFAULT NULL,
    updated_by      VARCHAR(100)  DEFAULT NULL,
    updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (brand)
);
```

| Column | Notes |
|---|---|
| `brand` | Lowercased key (e.g. `'birlaopus'`). PK enforces one-row-per-brand. |
| `raw_text` | Original pasted text. Audit + future re-parse capability if parser logic changes. |
| `parsed_rows` | `parseBirlaOpusTabular(raw_text)` result as a JSON array. Read directly by `matchWithZohoItems` — no re-parse on Match Now. |
| `parsed_count` | Cached `parsed_rows.length` for the summary card. Avoids JSON_LENGTH() on every GET. |
| `effective_date` | Date printed on the DPL ("Effective 25 Feb 2026"). Admin enters manually; defaults to today. |
| `updated_by` | `req.user.username` snapshot at save time. |
| `updated_at` | Auto-stamped via `ON UPDATE CURRENT_TIMESTAMP`. |

**Migration**: `migrate-brand-dpl-lists.js` — `CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE INTO _migrations` per the project's pattern (`reference_prod_migrations_gap.md`). No data backfill — table starts empty.

**Storage**: Birla Opus DPL ≈ 50KB raw + ~250KB parsed JSON. MEDIUMTEXT max 16MB; JSON max in MariaDB 10.11 ~1GB. Far under limits.

## Components

### Endpoint 1: `GET /api/zoho/items/brand-dpl/:brand`

Returns saved-DPL summary for the summary card. Optional `?include=raw` query returns `raw_text` too (used by Update DPL flow).

- **Auth**: `requirePermission('zoho', 'manage')`.
- **200**:
  ```json
  {
    "success": true,
    "data": {
      "brand": "birlaopus",
      "parsed_count": 1248,
      "effective_date": "2026-02-25",
      "updated_at": "2026-05-10T13:45:22.000Z",
      "updated_by": "sharjoon1",
      "raw_text": "<only if ?include=raw>"
    }
  }
  ```
- **404** when no row exists for brand:
  ```json
  { "success": false, "code": "NO_SAVED_DPL", "message": "No DPL saved for this brand" }
  ```
- **400** if `:brand !== 'birlaopus'` (other brands not yet supported).

### Endpoint 2: `POST /api/zoho/items/brand-dpl/:brand`

Save (or replace) brand DPL. Optionally runs match in same call.

- **Auth**: `requirePermission('zoho', 'manage')`.
- **Body**: `{ text: string, effective_date?: ISO date string, match?: boolean }`.
  - `effective_date` defaults to today (`new Date().toISOString().slice(0, 10)`).
  - `match` defaults to `true`.
- **Validation**:
  - `:brand` must be `'birlaopus'`. Other → 400.
  - `text` non-empty + ≤ 1,000,000 chars.
  - `parseBirlaOpusTabular(text)` must yield ≥ 1 row. Else 400 with message "No data rows found in pasted text".
- **Logic**:
  1. Parse text → `parsedRows`.
  2. Read existing row (if any) for audit log `before` snapshot.
  3. `INSERT INTO brand_dpl_lists (...) VALUES (...) ON DUPLICATE KEY UPDATE raw_text=VALUES(raw_text), parsed_rows=VALUES(parsed_rows), parsed_count=VALUES(parsed_count), effective_date=VALUES(effective_date), updated_by=VALUES(updated_by)`.
  4. `audit-log.record(req, { action: 'brand_dpl.save', entity_type: 'brand_dpl_lists', entity_id: brand, before, after })`.
  5. If `match === true` (default): build `cleanItems` via `PASTE_CAT_TO_CANON`, run `matchWithZohoItems`, build `match` payload (same shape as the deleted `parse-pasted-dpl` returned).
  6. Respond with `{ saved: {...}, match?: {...} }`.

- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "saved": {
        "brand": "birlaopus",
        "parsed_count": 1248,
        "effective_date": "2026-02-25",
        "updated_at": "2026-05-10T13:45:22.000Z",
        "updated_by": "sharjoon1"
      },
      "match": {
        "brand": "birlaopus",
        "pages": 0,
        "totalExtracted": 1248,
        "autoMatched": 450,
        "needsReview": 798,
        "items": [...],
        "zohoItems": [...],
        "source": { "type": "stored-dpl", "parsed": 1248 }
      }
    }
  }
  ```

### Endpoint 3: `POST /api/zoho/items/brand-dpl/:brand/match`

Re-match using already-saved data. No text in body.

- **Auth**: `requirePermission('zoho', 'manage')`.
- **Logic**:
  1. `SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?`. If no row → 404 with `NO_SAVED_DPL`.
  2. Apply `PASTE_CAT_TO_CANON` mapping (same as save endpoint).
  3. Fetch active Zoho items + same-brand filter.
  4. `matchWithZohoItems` → build `match` payload.
- **Response**:
  ```json
  { "success": true, "data": { /* same `match` shape as Endpoint 2's data.match */ } }
  ```

### Shared helper: `PASTE_CAT_TO_CANON`

Move the inline category-mapping table from the deleted endpoint into a top-of-file constant in `routes/zoho.js` so both Endpoint 2 and Endpoint 3 share it without duplication.

### Deleted code

- `POST /api/zoho/items/parse-pasted-dpl` (added today at `routes/zoho.js:5290-5465`) — entirely removed.
- Frontend `parsePastedText()` function — removed; replaced by `saveBrandDpl()` and `matchSavedDpl()`.

### Frontend (`admin-dpl.html`)

**State machine on brand select**:

1. `selectBrand(brand)` (existing function) gets a new tail call: `loadBrandDplState(brand)`.
2. `loadBrandDplState(brand)`:
   - `GET /api/zoho/items/brand-dpl/{brand}`.
   - 200 → call `renderSavedDplCard(data)` to show summary card.
   - 404 (`NO_SAVED_DPL`) → call `renderPasteDplUI()` to show textarea + Save & Match button.
   - Other errors → toast, stay on default UI.

**Saved Summary Card** (replaces the amber paste panel content when saved):
- Compact card: rows count, effective date (formatted "25 Feb 2026"), last updated relative time + username.
- Two buttons: "⚡ Match Now" → `matchSavedDpl()`; "📝 Update DPL" → `startUpdateDpl()`.

**Paste UI** (when no saved DPL or Update DPL clicked):
- Existing textarea (`#pastedDplText`) — reused.
- New `<input type="date" id="pastedDplEffectiveDate">` next to Save button. Defaults to today.
- Single button "💾 Save & Match" → `saveBrandDpl()`.
- "Lines detected" counter — unchanged.

**Functions**:

| Function | Purpose |
|---|---|
| `loadBrandDplState(brand)` | GET state, swap UI |
| `renderSavedDplCard(data)` | Build + inject summary card HTML |
| `renderPasteDplUI()` | Show textarea+button (default state) |
| `saveBrandDpl()` | POST text → set `aiData` from `data.match` → `showAiResults()` → reload state |
| `matchSavedDpl()` | POST `/match` → set `aiData` → `showAiResults()` |
| `startUpdateDpl()` | GET `?include=raw` → pre-fill textarea → switch to Paste UI |

**`backToUpload()`** (existing function) gets a tail call to `loadBrandDplState(currentBrand)` so the right view is shown after returning from review.

## Tests

Unit tests in `tests/unit/brand-dpl.test.js`:

1. Migration runs idempotently (CREATE TABLE IF NOT EXISTS).
2. POST save with valid text → row inserted; `parsed_rows` JSON length matches `parsed_count`.
3. POST save when row exists → row replaced (not duplicated); old `updated_at` overwritten.
4. POST save with `match: false` → response has `saved` only, no `match`.
5. POST save with empty text → 400.
6. POST save with text that yields zero parseable rows → 400 with specific message.
7. GET when row exists → returns summary; without `?include=raw`, no `raw_text` in payload.
8. GET when no row → 404 with `NO_SAVED_DPL` code.
9. POST `/match` when row exists → returns match payload; without parsing the text again (verifiable by checking `parseBirlaOpusTabular` is not invoked — spy/stub).
10. POST `/match` when no row → 404.
11. Brand validation: `/match` and POST/GET reject any brand that's not `'birlaopus'` with 400.

The existing `parseBirlaOpusTabular` tests (31 cases) continue to pass — that parser is unchanged.

## Migration & Cutover Plan

1. Run `migrate-brand-dpl-lists.js` on dev → table created.
2. Code change in feature branch: add 3 endpoints, delete the old `parse-pasted-dpl` endpoint, update frontend.
3. Deploy in normal cycle (`git pull` + `pm2 restart`) — table-then-code order means a worst-case race produces a 500 ("table doesn't exist") only between migration step and code deploy on prod, which the deploy command sequences correctly.
4. First admin user to select Birla Opus sees the Paste UI (no row exists). They paste + Save & Match → row populated. From the second visit on, Saved Summary appears.

No data backfill needed because the previous flow stored nothing.

## File Touch List

- **Create** `migrate-brand-dpl-lists.js`
- **Create** `tests/unit/brand-dpl.test.js`
- **Modify** `routes/zoho.js` — add 3 endpoints, delete `parse-pasted-dpl`, hoist `PASTE_CAT_TO_CANON` to a shared const
- **Modify** `public/admin-dpl.html` — state-machine wiring, replace `parsePastedText()` with `saveBrandDpl`/`matchSavedDpl`/`startUpdateDpl`/`loadBrandDplState`/`renderSavedDplCard`/`renderPasteDplUI`, add effective-date input

No new npm dependencies. No changes to `services/price-list-parser.js` (parser unchanged). No changes to push-to-Zoho path.
