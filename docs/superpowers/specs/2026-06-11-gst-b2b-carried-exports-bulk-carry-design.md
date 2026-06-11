# GST B2B Carried-Forward Exports + Bulk Carry-Forward — Design

**Date:** 2026-06-11
**Page:** `public/admin-gst-reports.html` → Filing tab → B2B section
**Route:** `routes/gst-reports.js`
**Status:** Approved (owner), ready for implementation plan

## Problem

The Filing tab's B2B export (`exportB2B()`) dumps only the natural-month B2B
invoices and **excludes** carried-forward invoices (`cache.filing.carried`).
Owner wants exports that **include** carried-forward at three granularities, plus
the ability to carry many missed invoices at once (today it is one-at-a-time).

## Scope

Three new B2B exports (all include carried-forward) + bulk carry-forward UI and
endpoint. No change to filing/cost compliance boundary or carry-forward
validation rules.

---

## A. Three exports (B2B section)

Replace the single `⬇ Invoices CSV` button with an **`⬇ Export ▾`** menu offering
three options. All are client-side CSV via the existing `csvDownload()` helper.
All include carried-forward invoices.

### A1. Overall (full list)
- Source: merge `cache.filing.b2b` (natural month) + `cache.filing.carried`
  (carried into this month). Ignores the customer dropdown filter — "overall"
  is always all customers.
- Columns: `Carried From | Invoice Date | Invoice Number | Customer | GSTIN | Taxable | GST | Total`.
  `Carried From` = `original_month` for carried rows, blank for natural rows.
- Trailing grand-total row (Taxable / GST / Total).
- File: `gst-filing-b2b-overall-<month>.csv`

### A2. Customer-wise (grouped)
- Same merged dataset as A1, sorted by `customer_name` then `invoice_date`.
- For each customer: its invoice rows followed by a **subtotal row**; a grand
  total row at the very end.
- Same columns as A1.
- File: `gst-filing-b2b-customerwise-<month>.csv`

### A3. Customer invoice-wise + HSN
- Item-level. Source: `cache.b2bItems` from `GET /api/gst-reports/b2b-items`
  (already includes carried invoices via the route's `carriedInvs`). If not yet
  loaded for the current month, fetch it first (reuse `loadB2BItems('filing')`
  fetch path / show the same "fetching from Zoho" state), then build the CSV.
- Order: customer → invoice → item.
- Columns: `Carried From | Customer | GSTIN | Invoice Date | Invoice Number | Item | HSN | Qty | Rate | Amount`.
  `Carried From` from `inv.carried_from`.
- File: `gst-filing-b2b-customer-invoice-hsn-<month>.csv`

Existing `exportB2BItems('filing')` (flat item-wise) stays as-is; A3 is a new,
customer-grouped variant.

---

## B. Bulk carry-forward (Missed invoice panel)

### B1. Server
- **Extend `GET /missed-b2b`** with optional query params: `from_date`,
  `to_date`, `min_amount`. Apply as additional `WHERE` clauses (parameterized).
  Raise the `LIMIT` (e.g. 100 → 500) so range filters can surface a complete set.
  Existing `search` param unchanged.
- **New `POST /carry-forward/bulk`** — `requirePermission('zoho','edit')`.
  - Body: `{ zoho_invoice_ids: [...], filed_in_month, note }`.
  - Validate `filed_in_month` via `monthRange()`.
  - One query fetches `invoice_number, invoice_date` for all ids.
  - For each: compute `original_month` (same logic as single route); keep only
    those with `original_month < filed_in_month`. Skip not-found and
    not-earlier with a reason.
  - Bulk `INSERT … ON DUPLICATE KEY UPDATE` (multi-row) for the valid set, in a
    single statement, `created_by = req.user.id`.
  - Response: `{ success: true, carried: <n>, skipped: [{ id, reason }] }`.

### B2. UI (`toggleMissedPanel` / `renderMissed`)
- Add filter inputs above the candidate list: `from_date`, `to_date`,
  `min_amount`; wiring them into the `/missed-b2b` query (debounced like the
  existing search).
- Add a checkbox column per candidate row + a header "Select all" checkbox.
- Add a **`Carry selected to <month>`** button → POST the checked
  `zoho_invoice_ids` to `/carry-forward/bulk`, then `loadActive()`. Surface
  `carried` count and any `skipped` reasons (toast/alert).
- Keep the existing per-row "Include in <month>" button for single carries.

---

## C. Do NOT change

- Filing (actual values) vs internal-cost split — exports here are filing
  actual values only; no cost data mixed in. (See memory
  `project_gst_reports_2026_06` — compliance boundary, never weaken.)
- Carry-forward validation: must move an invoice to a **later** month only.
- `deriveTax` / sub_total derivation logic.

---

## Testing

`tests/unit/gst-reports.test.js` (exists): add coverage for `POST
/carry-forward/bulk` behavior — valid carry inserted, not-found skipped,
not-later-month skipped, duplicate updates rather than errors. Mock pool like
the existing tests in that file.

## Files touched

- `routes/gst-reports.js` — `/missed-b2b` params, new `/carry-forward/bulk`.
- `public/admin-gst-reports.html` — Export menu (A1–A3), missed-panel filters +
  checkboxes + bulk button.
- `tests/unit/gst-reports.test.js` — bulk route tests.
