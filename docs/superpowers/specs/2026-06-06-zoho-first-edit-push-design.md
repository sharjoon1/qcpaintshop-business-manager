# Zoho-First View — Edit Zoho Item Details + Per-Row Push — Design

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan
**Area:** DPL Catalog Zoho-first view (`public/admin-dpl.html`, `routes/zoho.js`, `services/dpl-catalog.js`)
**Builds on:** [[project-dpl-zoho-first-reconciliation-2026-06]] (Zoho-first tab + cards/auto-propose/filters, prod HEAD `fd290b1`).

---

## 1. Problem

The DPL-first view lets the user edit an entry's details in an edit sheet
(`openCatEdit` → `PUT …/entry/:id`, editing `canonical_name/sku/description` locally).
The Zoho-first view has no edit affordance. The user wants to edit **the real Zoho
item** (the row itself) — its name, SKU, DPL, and selling rate — directly from the
Zoho-first row, working the same two-step way DPL-first does (edit saves locally,
then a separate Push sends it to Zoho).

## 2. Goal

Add to each Zoho-first row/card:

1. An **✏ Edit** action opening a sheet to edit the real Zoho item's **Name, SKU,
   Description, DPL**. The selling **Rate is auto-computed** (`ceil(dpl×1.18×1.10)`)
   and shown read-only, updating live as DPL changes. **Save is local** — it writes
   `zoho_items_map` only, no Zoho call (mirrors DPL-first's local save).
2. A per-row **⬆ Push to Zoho** action that pushes that one item's
   name/SKU/description/DPL/rate to the live Zoho item via the existing bulk-edit
   job path, then mirrors confirmed values back to `zoho_items_map`.

**Non-goals:** No change to the DPL-first view, the Zoho-first read/cards/filters/
auto-propose, the rate formula, the catalog push, or the `dpl_catalog`/`zoho_items_map`
schemas. Editing does not touch `dpl_catalog`. The edit edits the Zoho item itself,
not the catalog canonical fields.

## 3. Decisions (from brainstorming)

- **Edit target:** the real Zoho item (`zoho_items_map`), not the linked catalog entry.
- **Save scope:** local only (like DPL-first); Zoho write is a separate per-row Push.
- **Push path:** per-row "Push to Zoho" button → reuses the audited `createBulkEditJob`.
- **Fields:** Name, SKU, Description, DPL editable; Rate auto-derived (read-only).

## 4. Backend — `routes/zoho.js` (perm `requirePermission('zoho','manage')`)

### 4.1 `PUT /api/zoho/items/zoho-item/:id` — local edit

- `:id` = `zoho_item_id` (string).
- Body: `{ name?, sku?, description?, dpl? }` (all optional; only provided fields
  update). `dpl` must be a finite number ≥ 0 and ≤ 100000 when present.
- When `dpl` is provided, compute `rate = computeZohoRate(dpl)` server-side
  (authoritative) and update both `zoho_cf_dpl` and `zoho_rate`.
- Build a parameterized dynamic `SET` (mirroring the existing `routes/estimates.js`
  pattern): `zoho_item_name`, `zoho_sku`, `zoho_description`, `zoho_cf_dpl`,
  `zoho_rate`. If no editable field was supplied → `400`.
- `UPDATE zoho_items_map … WHERE zoho_item_id = ?`. If `affectedRows === 0` → `404`
  (no such active item).
- SKU uniqueness is NOT enforced here (local edit can stage a temporarily-conflicting
  SKU; the push step validates). Returns `{ success: true, rate }` (the computed rate,
  or the unchanged one).

### 4.2 `POST /api/zoho/items/zoho-item/:id/push` — push one item to Zoho

- `:id` = `zoho_item_id`.
- Read the current `zoho_items_map` row (`zoho_item_name, zoho_sku, zoho_description,
  zoho_cf_dpl, zoho_rate, zoho_purchase_rate, zoho_category_name, zoho_status`). If
  not found → `404`.
- Require a DPL price: `zoho_cf_dpl > 0`, else `400` ("Set a DPL before pushing").
- **SKU-conflict guard** (same rule the catalog push uses): if another **active**
  item holds the same `UPPER(zoho_sku)`, return `409` with a clear message naming the
  holder — do not push.
- Build `changes = { cf_dpl, purchase_rate: cf_dpl, rate, name, sku, description }`
  from the current (locally-edited) row values (`rate = zoho_rate` or recomputed via
  `computeZohoRate(cf_dpl)` if null). `cf_dpl` is sent as-is — `services/zoho-api.js
  updateItem` wraps `cf_*` into `custom_fields`.
- `createBulkEditJob([{ zoho_item_id, item_name, changes }], req.user)` (same call the
  catalog push makes). Return `{ success: true, job_id: result.job_id }`.
- The bulk-job path already mirrors confirmed SKU/values back to `zoho_items_map`, so
  no extra mirror code is needed here.

### 4.3 Service helper — `services/dpl-catalog.js`

`computeZohoRate(dpl)` — pure: `const d = parseFloat(dpl); return Number.isFinite(d)
&& d > 0 ? Math.ceil(d * 1.18 * 1.10) : 0;`. Exported and unit-tested. Reused by both
endpoints (and available to the frontend's preview, which computes the same formula
inline). Existing inline `Math.ceil(dpl*1.18*1.10)` call sites are left untouched
(out of scope).

## 5. Frontend — `public/admin-dpl.html` (Zoho-first view)

### 5.1 Row/card actions

Each Zoho-first row gains, alongside the existing status/proposal area, two small
buttons: **✏ Edit** (`openZfEdit(zoho_item_id)`) and **⬆ Push** (`pushZfItem(zoho_item_id)`).
Both appear in the desktop table action area and on the mobile card. Reuse the page's
`esc`/`getToken`/`showToast`/`loadZohoFirst`.

### 5.2 Edit sheet (`#zfEditModal`)

A modal mirroring the DPL-first `#catEdit` sheet:
- **Read-only context:** Zoho item name (current), `zoho_sku`, category.
- **Editable inputs:** `#zfEditName` (text), `#zfEditSku` (text), `#zfEditDesc`
  (textarea), `#zfEditDpl` (number).
- **Rate preview:** `#zfEditRatePreview` (read-only), recomputed on `#zfEditDpl`
  `oninput` as `Math.ceil(dpl*1.18*1.10)` (shows `—` for blank/invalid).
- **Save** (`saveZfEdit()`): `PUT /api/zoho/items/zoho-item/<id>` with `{name, sku,
  description, dpl}` → toast → close → `loadZohoFirst()`.
- The current row's values prefill the sheet via `openZfEdit(id)`, which finds the row
  in `zfRows` (`zoho_name`, `zoho_sku`, `old_dpl`, `category`). `zfRows` does not carry
  the Zoho description, so the description box starts blank. The Save always includes
  the `description` field in the body, so whatever is in the box is written (a blank box
  clears the Zoho-local description) — see §7. This is intentional and simple: the user
  sees and edits the field deliberately.

### 5.3 Push (`pushZfItem(id)`)

`POST /api/zoho/items/zoho-item/<id>/push` → on success toast `Pushed to Zoho (job
#N)` → `loadZohoFirst()`. On `409` SKU-conflict, surface the server message in the
toast. Disable the button while in flight (spinner), matching the existing push button
pattern.

### 5.4 Escaping

All prefilled values are set via `.value` (input properties — not `innerHTML`), so no
escaping issue for inputs. Any value rendered into row/card HTML continues to use
`esc()`.

## 6. Data flow

```
✏ Edit → openZfEdit prefills sheet from zfRows
        → Save → PUT /zoho-item/:id  → UPDATE zoho_items_map (name/sku/desc/cf_dpl/rate)  [LOCAL]
        → loadZohoFirst() re-renders

⬆ Push → POST /zoho-item/:id/push → SKU-conflict guard → createBulkEditJob([1 item])  [→ ZOHO]
        → bulk job updateItem + mirror back to zoho_items_map
        → loadZohoFirst() re-renders
```

## 7. Error handling

- PUT: invalid/missing id → 400; no editable field → 400; bad `dpl` (non-numeric / <0
  / >100000) → 400; `affectedRows === 0` → 404. Parameterized SQL only.
- **Description blank-vs-unchanged:** v1 keeps it simple — the PUT updates
  `zoho_description` only when the `description` key is present in the body, and the
  frontend includes `description` in the body on every save (so a cleared box DOES
  clear the Zoho-local description). This is acceptable because the user opens the
  sheet, sees the field, and edits intentionally; documented so it isn't surprising.
- Push: no item → 404; no DPL → 400; SKU conflict → 409 (named holder); bulk-job
  failure → 500 with message. The conflict guard prevents Zoho's duplicate-SKU
  rejection from failing silently.
- Frontend: every failure shows a toast and leaves the sheet/row state intact.

## 8. Testing

- **Unit (`tests/unit/dpl-catalog-zoho-first.test.js` or a small new file):**
  `computeZohoRate` — `100→130` (`ceil(100*1.18*1.10)=130`), `500→649`, `0→0`,
  `null→0`, string `'500'→649`, negative → 0.
- **E2E (`tests/e2e/admin-dpl-zoho-first.spec.js`, extend):** render a row, click ✏
  Edit, confirm the sheet opens prefilled; change `#zfEditDpl` and assert
  `#zfEditRatePreview` updates to the computed rate; assert the ⬆ Push button is
  present on the row. (Backend calls are stubbed/asserted via a captured fetch, as the
  existing e2e does not hit a live server.)

## 9. Isolation / boundaries

- `computeZohoRate` is a one-line pure helper. The two endpoints are thin and
  self-contained, reusing the existing `createBulkEditJob` push path (no new Zoho-write
  logic). The frontend additions are scoped to the Zoho-first view. DPL-first, the
  Zoho-first read path, and the schemas are untouched.

## 10. Open items / future (out of scope for v1)

- Bulk "edit + push" of multiple Zoho items at once.
- Editing `zoho_category_name` / `zoho_purchase_rate` from the sheet.
- A dirty/"edited, not pushed" indicator on rows (the push is always available; v1
  does not track local-edit-since-push state on the Zoho-first row).
