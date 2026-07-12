# SP-1 — Payment Settlement Sync (AR + AP) + Invoice Discount Push Fix

## Context

Owner's #1 goal: staff must stop double-entering daily work in Zoho Books UI. The 2026-07-12
discovery (`.claude-notes/discovery-2026-07-12-three-domains.md`) found the biggest daily forcing
function is **payment settlement**: payments recorded in-app never reach Zoho Books —
AR: `routes/billing.js:1065` has no Zoho call (only a push-moment aggregate forward hardcoded
`payment_mode:'Cash'`, Zoho payment id discarded, `services/billing-zoho-service.js:276-293`);
AP: `routes/vendors.js:1694` is local-only and `services/zoho-api.js` has **no** `/vendorpayments`
method at all. Two live money bugs ride along: **invoice-level discount is never sent on push**
(Zoho total = app total + discount) and **payment-mode/date infidelity**. Also: both delete flows
refuse when payments exist ("reverse it first") but **no reversal path exists** — a dead end that
gets worse once payments live in both systems.

Owner decisions taken 2026-07-12: start with SP-1; `'credit'`-method payments are **never**
forwarded to Zoho; payment **reversal is in scope** (final phase, admin-only); **on-account vendor
payments ARE pushed** (unapplied, accountant applies later in Zoho).

Money-critical domain → execution is **Build + Judge** (money-builder + judge agents, Opus tier,
per orchestration.md), characterization tests before every behavior change, everything additive.

## Verified current mechanics (evidence base)

- AR record: `routes/billing.js:1065-1129` — idempotent middleware, Zod enum
  `['cash','upi','bank_transfer','cheque','credit']`, INSERT → re-SUM → UPDATE header, **no
  transaction**, no Zoho, no audit. `billing_payments` has NO zoho columns, NO payment_date, NO
  deleted_at. DECIMALs arrive as strings.
- AR push: `services/billing-zoho-service.js:105-307` — guards (already-pushed :114,
  SALESPERSON_REQUIRED :129, credit gate PUSH_GATE :168-216), payload = line_items only (**no
  discount/tax keys**), `finalizeDocument` BEFORE payment (staff→submitted, admin→approved), then
  ONE aggregate `createPayment(payment_mode:'Cash')`, error swallowed, id discarded.
- AP record: `routes/vendors.js:1694-1736` — enum `['bank_transfer','cheque','upi','cash']`,
  `payment_date` required, on-account allowed (`bill_id` NULL), bill re-SUM.
  `vendor_payments.zoho_payment_id VARCHAR(50)` **exists, never written**.
- Bill push (house pattern to mirror): `routes/vendors.js:976-1106` — entity-level discount block
  `{discount, is_discount_before_tax:true, discount_type:'entity_level', discount_account_id}`,
  ai_config resolvers (`resolveDefaultGstTaxId` :620, `resolvePurchaseDiscountAccountId` :605),
  stamp-on-success / status-untouched-on-failure, retry = re-POST.
- zoho-api: `createPayment`→POST /customerpayments (:115), `apiDelete` exists unused (:1051), NO
  retry (throws; 30s timeout with ambiguous outcome), 80/min limiter queue, DB-backed OAuth.
  Working tree has an uncommitted `wrapCustomFields` refactor (B-2, judged PASS 2026-07-02).
- Zoho API (docs verified): customerpayments requires customer_id/payment_mode/amount/date/
  invoices[{invoice_id,amount_applied}], reference_number ≤100; vendorpayments requires only
  vendor_id+amount — `bills[]` optional (unapplied allowed), `paid_through_account_id` optional;
  DELETE exists for both. Zoho refuses payments on draft/pending-approval invoices and refuses
  voiding paid invoices.
- Timezone trap: DB session UTC, server IST — naive `toISOString()` mis-dates late-evening
  payments; Zoho invoice date = push day (IST); Zoho rejects payment date < invoice date.
- Nothing double-counts: AI/collections read only the `zoho_payments` mirror, never
  `billing_payments`; painter points key on invoices, never payments.

## Design (merged happy-path + risk review)

### Core sync engine (shared shape, AR + AP)

1. **Local-first, always.** Payment record endpoint wraps INSERT + re-SUM in a real transaction
   with `SELECT … FOR UPDATE` on the invoice/bill row (closes the existing TOCTOU overpay hole),
   COMMITs, and only then attempts Zoho sync. A Zoho failure never affects the local record or the
   HTTP status; response gains point-in-time `zoho_sync` field; UI renders live state from list
   data, never from the cached create response.
2. **Duplicate-proofing (the 2 layers):**
   - Deterministic `reference_number`: `ACT-BP-<billing_payments.id>` / `ACT-VP-<vendor_payments.id>`.
   - Atomic claim: `UPDATE … SET zoho_payment_id='SYNCING' WHERE id=? AND zoho_payment_id IS NULL`
     (affectedRows=0 → someone else owns it). Then **check-before-create**: GET payments filtered
     by reference; exact-match → adopt the existing Zoho id (no POST). Else POST, stamp real id.
     Failure → reset to NULL + store `zoho_sync_error`. Crash mid-'SYNCING' → stale claims (>5 min)
     reclaimable via the adopt-first path.
   - `zoho_payment_id` states: `NULL`=pending, `'SYNCING'`=in-flight, `'LEGACY'`=pre-SP1
     (never touch), real id=synced. `'credit'` rows excluded everywhere (`payment_method != 'credit'`).
3. **Pre-POST GET of the Zoho invoice** (AR) feeds four guards in one call: correct `customer_id`
   (never `resolveZohoContact` in the payment path); status guard (`void`/`draft`/nonexistent →
   fail-soft with clear error; pending-approval → stays pending, auto-retried when the existing
   approval sync-back flips to approved); **balance clamp** — delta ≤ ₹1 → clamp amount_applied to
   Zoho balance (NIT-1 zone), delta > ₹1 → fail-soft with human-readable error; **date** =
   `max(payment_date IST, zoho invoice date)`.
4. **Mode mapping** in one pure module: defaults `{cash:'cash', upi:'UPI',
   bank_transfer:'banktransfer', cheque:'check', credit:null}`; unknown → `'others'`; ai_config
   `zoho_payment_mode_map` JSON override (fix-by-config, no deploy). On a mode-shaped Zoho
   rejection: retry once with `'others'`, real method in description; then fail-soft.
5. **Push-time forwarding rework:** replace the aggregate-'Cash' block with per-row forwarding of
   unsynced rows through the SAME sync function (one code path, one mutex). Partial failures never
   fail the push; summary returned. Staff pushes land 'submitted' → payments stay pending until
   approval (sync-back re-fires them) — surfaced in the UI message, not silent like today.

### AP specifics
- New `services/vendor-zoho-service.js` (mirrors billing-zoho-service shape).
- `paid_through_account_id` from new ai_config key `zoho_vendor_paid_through_account_id`
  (omit when unset; accountant seeds the value — needed before go-live, single account for now).
- Bill-linked: requires bill pushed (`BILL_NOT_PUSHED` 400 otherwise); `location_id` from the
  bill. On-account: no `bills[]`, no location (owner-approved). Vendor must already have
  `zoho_contact_id` (`VENDOR_NOT_IN_ZOHO` — payment sync never creates contacts).
- After a successful bill push, best-effort sync that bill's pending payments.

### Discount push fix (AR)
- Payload gains `{discount: <amount>, is_discount_before_tax: true, discount_type: 'entity_level'}`
  when `discount_amount > 0` — mirrors the proven bill-push block; no account id (purchase-side
  concept; if the sales org config demands one, D1 surfaces it and ai_config
  `zoho_sales_discount_account_id` is the ready slot).
- Behind ai_config flag **`billing_invoice_discount_push_enabled` default '0'** — flag-off is
  byte-identical to today (characterization-proven). Enabled only after the D1 draft verification
  passes on the real org. New `options.draftOnly` on `pushInvoiceToZoho` (admin-only via push route
  body `draft_only:true`): creates the Zoho invoice, skips finalize + payment forwarding — a Zoho
  draft has zero GST impact and is hard-deletable.

### Reversal (final phase, owner-approved)
- `DELETE /api/billing/payments/:id` + `DELETE /api/vendors/payments/:id`, `isFullAdmin` only.
- Order: real Zoho id → `deleteCustomerPayment`/`deleteVendorPayment` first (tolerate
  `/does not exist|1002/i`); any other Zoho error → abort, local untouched, Zoho message verbatim.
  `'LEGACY'` → skip Zoho call, response says "adjust in Zoho manually". Then local **soft delete**
  (`deleted_at`) + re-SUM parent totals in a transaction + audit with full before-image.
- Extract shared helpers `recalcInvoicePaymentTotals` / `recalcBillPaymentTotals` (record +
  reverse share one tested path; billing recalc gains the new totalPaid=0 → 'unpaid' case).
- Every `billing_payments`/`vendor_payments` read site gains `AND deleted_at IS NULL`
  (billing.js: 271, 877, 908, 992, 1099, 1156, 1167; vendors.js: 503, 1146, 1665, 1672, 1712,
  1802 — re-locate at implementation time). A fully-reversed invoice/bill becomes deletable again,
  closing the "reverse it first" dead end. Zero pointsEngine interaction (test-locked).

### Migration — `migrations/20260712_payment_zoho_sync.js` (additive, info-schema-guarded, direct-run block)
```sql
ALTER TABLE billing_payments  ADD COLUMN payment_date DATE NULL AFTER payment_reference;
ALTER TABLE billing_payments  ADD COLUMN zoho_payment_id VARCHAR(50) NULL AFTER notes;
ALTER TABLE billing_payments  ADD COLUMN zoho_sync_error VARCHAR(255) NULL AFTER zoho_payment_id;
ALTER TABLE billing_payments  ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
UPDATE billing_payments SET payment_date = DATE(CONVERT_TZ(created_at,'+00:00','+05:30')) WHERE payment_date IS NULL;
ALTER TABLE vendor_payments   ADD COLUMN zoho_sync_error VARCHAR(255) NULL AFTER zoho_payment_id;
ALTER TABLE vendor_payments   ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
-- LEGACY sentinels (fixed cutoff literal = deploy date; idempotent re-runs):
UPDATE billing_payments bp JOIN billing_invoices bi ON bi.id=bp.invoice_id
   SET bp.zoho_payment_id='LEGACY'
 WHERE bi.zoho_status='pushed' AND bp.zoho_payment_id IS NULL AND bp.created_at < '<CUTOFF>';
UPDATE vendor_payments SET zoho_payment_id='LEGACY'
 WHERE zoho_payment_id IS NULL AND created_at < '<CUTOFF>';
```
LEGACY protects against double-pay: old AR payments were covered by push-time aggregates; old AP
payments were hand-entered in Zoho by the accountant. Payments on **not-yet-pushed** invoices stay
NULL — the new per-row push-time forwarding covers them (no regression).

## Files to touch

| File | Change |
|---|---|
| `services/zoho-api.js` | +`createVendorPayment`, `getVendorPayments`, `deleteCustomerPayment`, `deleteVendorPayment` (mirror `createPayment` :115; exports :2629). Additive only — don't disturb the uncommitted wrapCustomFields refactor (commit it first as its own B-2 commit). |
| NEW `services/zoho-payment-mapper.js` | Pure: `mapPaymentModeToZoho`, `loadModeOverrides(pool)`, `buildCustomerPaymentPayload`, `buildVendorPaymentPayload`, `classifyPaymentReversal` — all exported for unit tests (paymentExceedsBalance precedent). |
| `services/billing-zoho-service.js` | Discount block (flag-gated) + `draftOnly`; replace :276-293 with `forwardInvoicePayments`; +`syncInvoicePaymentsToZoho`; approval sync-back re-fires pending payment sync. |
| NEW `services/vendor-zoho-service.js` | `pushVendorPaymentToZoho`, `syncBillPayments`, `resolveVendorPaidThroughAccountId`. |
| `routes/billing.js` | Payment endpoint: +transaction/FOR UPDATE, +`payment_date` in schema+INSERT, +inline best-effort sync, +audit; +`POST /invoices/:id/sync-payments`; +`DELETE /payments/:id`; recalc helper extraction; `deleted_at` filters; SELECTs return `zoho_payment_id`. |
| `routes/vendors.js` | Payment endpoint: +inline best-effort sync +audit; +`POST /payments/:id/push-zoho`; +`DELETE /payments/:id`; bill push → `syncBillPayments`; recalc helper; `deleted_at` filters; payments list returns sync state. |
| `migrations/20260712_payment_zoho_sync.js` | As above. |
| `public/staff-billing.html` | Payment modal +date field; per-payment badges (`zoho ✓`/`pending`/`local (credit)`/`legacy`); "Sync payments" button on pushed invoices; admin "Reverse" button. Inline JS (page is permissive-CSP). |
| `public/staff-vendors.html` | Payment badges + per-payment "Push to Zoho" + admin "Reverse". |

## Commit plan (each independently green: `npm test` + `npm run lint`)

0. Commit the pending B-2 `wrapCustomFields` refactor (already judge-PASSed) to clean the tree.
1. **Characterization tests only**: current push payload has NO discount/tax keys even with
   discount_amount>0; push-time payment = ONE aggregate 'Cash', id discarded, error swallowed;
   AP record makes zero Zoho calls; delete-refusal codes; current payment response shape.
2. **Migration + zoho-api methods + mapper module** (+tests: raw-https lock for new endpoints,
   full mapper table incl. credit→null/unknown→others/overrides; migration `up()` idempotency test).
3. **AR discount fix + draftOnly** (flag-gated; update the characterizations to lock new behavior).
4. **AR payment sync** (record-time inline, push-time per-row, sync-payments endpoint, approval
   re-fire, audit; tests: N rows→N createPayment calls with per-row mode/date/reference, stamp per
   success, claim prevents concurrent double-POST, adopt-on-found makes zero POSTs, clamp table
   {-5, 0, .01, .99, 1.01, 500}, void/pending-approval handling, credit/LEGACY/SYNCING exclusion,
   IST date + minDate clamp, Zoho throw ≠ HTTP failure).
5. **AP push** (vendor-zoho-service + routes + bill-push hook; tests: on-account no-bills payload,
   bill-linked with location, BILL_NOT_PUSHED / VENDOR_NOT_IN_ZOHO, paid_through only when
   configured, stamp+adopt+claim same as AR).
6. **Reversal + deleted_at filters + recalc helpers** (tests: Zoho-fail→local untouched;
   404→proceed; LEGACY→no Zoho call; recalc transitions incl. new 'unpaid'; zero pointsEngine
   calls; delete-refusal flips open after full reversal).

Each money commit runs through **money-builder → judge** (independent sessions, Opus) per
orchestration.md; judge auto-fails without honest characterization-first diffs.

## Verification (no staging — this IS the test tier)

Local: full suite green (906+ tests + new), lint clean, migration run on dev DB
(`node migrate.js`; dev DB is 19 migrations behind — run pending first).

Prod deploy: `git stash && git pull && npm install && pm2 restart` (house dirty-tree gotcha), then
`node migrations/20260712_payment_zoho_sync.js` + `INSERT IGNORE INTO _migrations …` (prod
tracking-gap procedure). Seed `zoho_vendor_paid_through_account_id` (value from accountant —
**needed before go-live**). All sync behavior ships live but harmless (discount behind flag;
payment sync fires only on new payments; LEGACY protects history).

Runbook (admin, ~15 min, before announcing to staff):
- **D1 discount draft check**: small test invoice w/ ₹10 discount, full cash payment, push
  `draft_only:true` → in Zoho: total == app grand_total, GST back-computed on (subtotal−discount),
  no error; delete draft in Zoho; reverse+delete locally. Pass → flip
  `billing_invoice_discount_push_enabled='1'`. Fail → flag stays off (rest of SP-1 unaffected),
  record evidence, revisit semantics.
- **D2 AR E2E**: test invoice → admin push → verify one Zoho customerpayment per app payment
  (record one `upi` payment to prove the risky mode; if rejected, seed `zoho_payment_mode_map`
  and re-sync — no deploy); record a post-push payment → verify inline sync; reverse both
  (proves deleteCustomerPayment) → delete invoice (proves the dead end is closed).
- **D3 AP E2E**: ₹1 on-account payment to a test vendor → unapplied vendorpayment in Zoho with
  mode/paid-through → reverse (proves deleteVendorPayment).

Rollback: discount = flag off (no deploy); payment sync = `git revert` + pm2 restart (local
recording untouched — sync is best-effort by construction); migration columns are inert if unused.

## Explicitly out of scope (follow-ups filed in discovery doc)
- Reconciliation report: pre-fix pushed discounted invoices (inflated Zoho totals) + LEGACY
  payment cross-check (`zoho_payments.reference_number LIKE 'ACT-%'` vs local stamps) — read-only,
  owner-reviewed, separate task.
- Per-mode paid-through accounts (cash→Petty Cash etc.); printable invoice/POS (SP-2); expense/
  credit-note creation (SP-3).
- Do NOT touch (settled): GST-inclusive `gst_amount:0`, ₹10 single-rounding, NIT-1 drift (the ≤₹1
  clamp honors it — never "fix" the drift itself), `checkCreditBeforeInvoice` permissive default,
  cf_* wrapping, lead auto-assign counting.

## Owner inputs still needed
1. Zoho **paid-through account id** from the accountant (before D3/go-live).
2. LEGACY cutoff date = actual deploy date (set at implementation).
On approval, this plan is also copied to `docs/superpowers/plans/2026-07-12-sp1-payment-sync.md`
and committed (repo convention).
