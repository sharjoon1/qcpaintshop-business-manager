# Share estimate/PO PDF via the phone's own WhatsApp — Design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

Today an estimate or purchase order can only be sent through the **business's logged-in
WhatsApp session** (server-side `sessionManager.sendMedia` — payment receipts, PO-to-vendor),
or shared as a **text + view-link** via `wa.me` (`shareViaWhatsApp()` on the estimate view).

Staff want an additional option: from a mobile device, share the **actual PDF file** through
the **phone's own WhatsApp app** (the native share sheet), so they can forward it to any
contact or group — not only to a typed phone number via the business session.

## Decisions (from brainstorming)

1. **What is shared:** the actual **PDF file** (not just a text link) via `navigator.share`.
2. **Surfaces:** estimate view page, purchase order, estimates list page, customer view page.
3. **Fallback** when Web Share file-share is unsupported (desktop browser / old native-app
   WebView): **download the PDF + open a `wa.me` text+view-link**.
4. The existing "WhatsApp" (text-link) button and the server-side send flows **stay** — the new
   "Share PDF" is a **separate, additional** button.
5. The customer-surface PDF uses the **PDFKit layout** (`generateEstimatePDF`, same as the
   public share PDF), not the Puppeteer-branded staff layout. Acceptable per user.

## Architecture

### New reusable client helper — `public/js/share-pdf.js`

Exposes `window.qcSharePdf(opts)`:

```
qcSharePdf({
  pdfUrl,        // string — URL to fetch the PDF blob from
  headers,       // object — request headers (e.g. Authorization Bearer); {} for public/customer
  filename,      // string — e.g. "Estimate-EST202606020001.pdf"
  shareTitle,    // string — share sheet title
  shareText,     // string — message body shown in WhatsApp
  fallbackUrl    // string — wa.me URL to open when Web Share (files) is unsupported
})
```

Behaviour:
1. `fetch(pdfUrl, { headers })` → if not ok, surface an error (`qcToast`/alert) and stop.
2. `blob` → `new File([blob], filename, { type: 'application/pdf' })`.
3. If `navigator.canShare && navigator.canShare({ files: [file] })`:
   `await navigator.share({ files: [file], title: shareTitle, text: shareText })`.
   - Catch and ignore `AbortError` (user cancelled the share sheet) — no error shown.
   - Other errors → fall through to the fallback.
4. Else (no file-share support): trigger a **download** of the blob (anchor + `download`
   attribute + `URL.createObjectURL`/`revokeObjectURL`) AND `window.open(fallbackUrl, '_blank')`.

The helper is self-contained, has no dependency on page globals, and is loaded only on the
pages that use it. One responsibility: turn a PDF URL into a phone-WhatsApp share (or fallback).

### PDF source per surface

| Surface | PDF endpoint | Auth |
|---|---|---|
| Estimate view (staff) | existing `GET /api/estimates/:id/pdf` | Bearer `auth_token` |
| Estimates list (staff) | existing `GET /api/estimates/:id/pdf` | Bearer `auth_token` |
| Purchase Order (staff) | existing `GET /api/estimates/:id/pdf?po=<po_number>&hide_payment=1` | Bearer `auth_token` |
| Customer view | **new** `GET /api/estimates/customer/:id/pdf` | `requireCustomerAuth` + phone-match |

### New backend route — `GET /api/estimates/customer/:id/pdf`

In `routes/estimates.js`, declared next to the existing `GET /customer/:id` (before `/:id`):

1. `requireCustomerAuth` middleware (Bearer customer token).
2. Fetch the estimate; 404 if missing.
3. Ownership check identical to `GET /customer/:id`: normalise both phones to last-10-digits and
   require `estimate.customer_phone` to match `req.customer.phone`, else 403.
4. Fetch items (same query as `/customer/:id`), load branding via the same helper the public
   share PDF uses, parse `column_visibility` with the same defaults.
5. `const { generateEstimatePDF } = require('./estimate-pdf-generator'); generateEstimatePDF(res, estimate, items, branding, colVis);`

This mirrors `routes/share.js` `GET /public/:token/pdf` (which already reuses
`generateEstimatePDF`), so no new PDF engine and no token minting.

**Branding helper extraction.** `getBranding()` is currently a private 10-line function in
`routes/share.js` (reads `business_name/logo/phone/email/address/gst` from the `settings` table;
depends only on `pool`). To avoid duplicating it in `routes/estimates.js`, extract it to a new
`services/branding.js` exporting `async getBranding(pool)`, and have **both** `routes/share.js`
and the new customer-PDF route call it. This is a small, focused improvement serving this goal —
no behavioural change to the public share PDF.

### Fallback view-link

The fallback `wa.me` text needs a view link. Reuse the existing share-link generation:
- **Staff surfaces:** call the existing `POST /api/share/whatsapp` (returns `whatsapp_url`) and
  use that as `fallbackUrl` — this already embeds a public view-link + message. (Only invoked on
  the fallback path, so no extra cost on the happy mobile path.)
- **Customer surface:** the customer cannot call the staff-gated `/api/share/whatsapp`. Fallback
  for the customer page is a `wa.me/?text=<message>` with the estimate number only (no
  generated link), since the customer is already viewing their own copy. (Customer desktop is a
  rare path.)

## UI changes

- **`public/estimate-view.html`** — add a **"📲 Share PDF"** button in the action bar, next to the
  existing "📱 WhatsApp" button. Calls `qcSharePdf` with the staff `/pdf` endpoint + Bearer.
- **`public/estimate-view.html` PO list/modal** — add "📲 Share PDF" next to "Resend via WhatsApp";
  uses `?po=<po_number>&hide_payment=1`, filename `PO-<po_number>.pdf`.
- **`public/estimates.html` + `public/estimates.js`** — add a "📲 Share PDF" action to the actions
  menu (`showActions` / `handleAction`).
- **`public/customer-estimate-view.html`** — add a **"📲 Share"** button; calls `qcSharePdf` with
  the new customer PDF endpoint + customer Bearer token.
- Load `public/js/share-pdf.js` on each of these four pages.

## Error handling

- PDF fetch failure (non-2xx / network) → user-visible error via the page's existing notifier
  (`qcToast` where available, else `alert`), no silent failure.
- `navigator.share` `AbortError` (user cancelled) → ignored silently.
- Customer PDF 403/401 → the customer page already redirects to `/customer-login.html` on 401;
  403 shows an error message.
- Backend route wraps DB + PDF generation in try/catch; on error and headers not yet sent,
  responds 500 (matching the public share PDF handler).

## Testing

- **Unit/integration (backend):** add a test that `GET /api/estimates/customer/:id/pdf` (a) 403s
  on phone mismatch, (b) returns `application/pdf` on match. Follow the existing test style under
  `tests/`.
- **Manual (mobile):** on a phone browser/PWA, tap "Share PDF" on each surface → OS share sheet
  shows WhatsApp → forwarding attaches the real PDF.
- **Manual (desktop):** the fallback downloads the PDF and opens `wa.me`.
- **Regression:** existing "WhatsApp" text-link button and server-side send flows unchanged;
  `node --check` + the estimate unit suite pass.

## Out of scope (YAGNI)

- No change to existing server-side WhatsApp send (receipts, PO-to-vendor).
- No change to the existing `wa.me` text-link `shareViaWhatsApp()`.
- No new PDF rendering engine; reuse `generateEstimatePDF` (customer) and the existing Puppeteer
  `/pdf` route (staff).
- No Android-native share intent work; the Web Share API + fallback covers the WebView.

## Files touched

- New: `public/js/share-pdf.js`
- New: `services/branding.js` (extracted `getBranding(pool)`)
- New route in: `routes/estimates.js` (`GET /customer/:id/pdf`)
- Edited: `routes/share.js` (use `services/branding.js`)
- Edited: `public/estimate-view.html`, `public/estimates.html`, `public/estimates.js`,
  `public/customer-estimate-view.html`
- New test under `tests/`
