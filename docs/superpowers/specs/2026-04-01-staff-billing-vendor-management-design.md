# Staff Billing System & Vendor Management — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Approach:** New Billing Module (separate from painter estimate system)

---

## Overview

Transform the app into a billing software where all staff can:
1. **Create estimates** for customers and painters
2. **Create direct invoices** without estimates
3. **Collect payments** (full, partial, or credit)
4. **Push invoices to Zoho Books**
5. **Manage vendors** — list, bills, purchase orders, payments
6. **AI bill verification** — KAI scans vendor bill photos, auto-fills products, verifies staff entries

## Phases

| Phase | Scope |
|-------|-------|
| **Phase 1a** | Staff billing — estimates + invoices + payments |
| **Phase 1b** | Zoho push + painter points integration |
| **Phase 2a** | Vendor list + bill management |
| **Phase 2b** | AI bill scan + verify (KAI) |
| **Phase 2c** | Purchase orders + vendor payments |

---

## Phase 1: Staff Billing

### Flows

**Estimate-first flow:**
```
Staff creates estimate → Sends to customer → Customer approves → Convert to invoice → Payment → Zoho push
```

**Direct invoice flow:**
```
Staff creates invoice directly → Payment collected → Zoho push
```

**Payment options:**
- Full payment (cash sale) → immediate Zoho push allowed
- Partial payment → track balance, manager decides when to push
- Credit (no payment) → manager pushes, Zoho tracks outstanding
- Painter billing → after payment, auto-award points

### Database Schema

#### `billing_estimates`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| estimate_number | VARCHAR(20) | `BE-YYYYMMDD-001` format |
| created_by | INT | Staff user_id (FK → users) |
| branch_id | INT | Staff's branch |
| customer_type | ENUM('customer','painter') | Who the estimate is for |
| customer_id | INT NULL | FK → zoho_customers_map |
| painter_id | INT NULL | FK → painters |
| customer_name | VARCHAR(255) | Name (new or existing) |
| customer_phone | VARCHAR(20) | Phone |
| customer_address | TEXT | Address |
| subtotal | DECIMAL(12,2) | Items total |
| discount_amount | DECIMAL(12,2) | Discount |
| grand_total | DECIMAL(12,2) | Final amount |
| status | ENUM('draft','sent','approved','converted','cancelled') | |
| converted_to_invoice_id | INT NULL | FK → billing_invoices |
| notes | TEXT | Remarks |
| valid_until | DATE | Estimate expiry |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `billing_estimate_items`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| estimate_id | INT FK | → billing_estimates |
| zoho_item_id | VARCHAR(50) | Zoho item reference |
| item_name | VARCHAR(255) | Product name |
| pack_size | VARCHAR(100) | Pack size label |
| quantity | DECIMAL(10,2) | Qty |
| unit_price | DECIMAL(10,2) | Rate per unit |
| line_total | DECIMAL(12,2) | qty × rate |
| display_order | INT | Sort order |

#### `billing_invoices`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| invoice_number | VARCHAR(20) | `BI-YYYYMMDD-001` format |
| created_by | INT | Staff user_id |
| branch_id | INT | Staff's branch |
| source | ENUM('direct','estimate') | How it was created |
| estimate_id | INT NULL | If converted from estimate |
| customer_type | ENUM('customer','painter') | |
| customer_id | INT NULL | FK → zoho_customers_map |
| painter_id | INT NULL | FK → painters |
| customer_name | VARCHAR(255) | |
| customer_phone | VARCHAR(20) | |
| customer_address | TEXT | |
| subtotal | DECIMAL(12,2) | |
| discount_amount | DECIMAL(12,2) | |
| grand_total | DECIMAL(12,2) | |
| amount_paid | DECIMAL(12,2) | Total paid so far |
| balance_due | DECIMAL(12,2) | grand_total - amount_paid |
| payment_status | ENUM('unpaid','partial','paid') | |
| zoho_status | ENUM('pending','pushed','failed') | |
| zoho_invoice_id | VARCHAR(50) NULL | After Zoho push |
| zoho_invoice_number | VARCHAR(50) NULL | |
| notes | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `billing_invoice_items`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| invoice_id | INT FK | → billing_invoices |
| zoho_item_id | VARCHAR(50) | |
| item_name | VARCHAR(255) | |
| pack_size | VARCHAR(100) | |
| quantity | DECIMAL(10,2) | |
| unit_price | DECIMAL(10,2) | |
| line_total | DECIMAL(12,2) | |
| display_order | INT | |

#### `billing_payments`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| invoice_id | INT FK | → billing_invoices |
| amount | DECIMAL(12,2) | Payment amount |
| payment_method | ENUM('cash','upi','bank_transfer','cheque','credit') | |
| payment_reference | VARCHAR(100) | UPI ref / cheque no |
| received_by | INT | Staff who collected |
| notes | TEXT | |
| created_at | TIMESTAMP | |

### API Routes — `routes/billing.js`

**Estimates:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| POST | `/api/billing/estimates` | `billing.estimate` | Create estimate |
| GET | `/api/billing/estimates` | `billing.estimate` | List (branch filtered) |
| GET | `/api/billing/estimates/:id` | `billing.estimate` | Get detail |
| PUT | `/api/billing/estimates/:id` | `billing.estimate` | Edit draft/sent |
| DELETE | `/api/billing/estimates/:id` | `billing.estimate` | Cancel draft |
| POST | `/api/billing/estimates/:id/send` | `billing.estimate` | Mark as sent |
| POST | `/api/billing/estimates/:id/convert` | `billing.invoice` | Convert to invoice |

**Invoices:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| POST | `/api/billing/invoices` | `billing.invoice` | Create direct invoice |
| GET | `/api/billing/invoices` | `billing.invoice` | List (branch filtered) |
| GET | `/api/billing/invoices/:id` | `billing.invoice` | Get detail |
| PUT | `/api/billing/invoices/:id` | `billing.invoice` | Edit (unpaid only) |
| POST | `/api/billing/invoices/:id/payment` | `billing.payment` | Record payment |
| POST | `/api/billing/invoices/:id/push-zoho` | `billing.zoho_push` | Push to Zoho Books |

**Products:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/billing/products` | `billing.estimate` | Search zoho_items_map |

### Permissions

| Role | billing.estimate | billing.invoice | billing.payment | billing.zoho_push |
|------|-----------------|----------------|----------------|------------------|
| Staff | Yes | Yes | Yes | No |
| Manager | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes |

Branch filtering: Staff sees own branch only. Admin/Manager can filter by branch or see all.

### Zoho Push Logic — `services/billing-zoho-service.js`

```
pushInvoiceToZoho(invoiceId):
  1. Load invoice + items from billing_invoices / billing_invoice_items
  2. Resolve Zoho contact:
     - customer_type = 'customer' → find/create in zoho_customers_map
     - customer_type = 'painter' → use painter's zoho_contact_id
  3. Credit limit check (if credit sale)
  4. Create Zoho invoice via zohoAPI.createInvoice()
  5. If painter → award points via painter-points-engine.js
  6. If payment exists → create Zoho payment via zohoAPI.createPayment()
  7. Update billing_invoices: zoho_status='pushed', zoho_invoice_id, zoho_invoice_number
```

### UI — `public/staff-billing.html`

**Three tabs:** Estimates | Invoices | Payments

**Estimates tab:**
- List view with status pills (draft/sent/approved/converted)
- "+ New Estimate" button → create form
- Create form: customer type toggle (Customer/Painter), customer search or add new, product search, items table, running total
- Actions: Save Draft / Send / Convert to Invoice

**Invoices tab:**
- List view with payment status pills (unpaid/partial/paid) + Zoho status (pending/pushed)
- "+ New Invoice" → same form as estimate, creates invoice directly
- Invoice detail → items + payment history + Zoho push button

**Payments tab:**
- Recent payments log — who collected, which invoice, amount, method
- "Record Payment" → select invoice, enter amount/method/reference
- Branch-wise daily collection summary

---

## Phase 2: Vendor Management

### Database Schema

#### `vendors`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| zoho_contact_id | VARCHAR(50) NULL | Zoho vendor contact ID |
| vendor_name | VARCHAR(255) | |
| contact_person | VARCHAR(255) | |
| phone | VARCHAR(20) | |
| email | VARCHAR(100) | |
| address | TEXT | |
| gst_number | VARCHAR(20) | |
| payment_terms | INT | Default payment days |
| status | ENUM('active','inactive') | |
| notes | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `vendor_bills`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| vendor_id | INT FK | → vendors |
| bill_number | VARCHAR(50) | Vendor's bill number |
| bill_date | DATE | |
| due_date | DATE | |
| subtotal | DECIMAL(12,2) | |
| tax_amount | DECIMAL(12,2) | |
| grand_total | DECIMAL(12,2) | |
| amount_paid | DECIMAL(12,2) | |
| balance_due | DECIMAL(12,2) | |
| payment_status | ENUM('unpaid','partial','paid') | |
| zoho_status | ENUM('pending','pushed','failed') | |
| zoho_bill_id | VARCHAR(50) NULL | |
| bill_image | VARCHAR(500) | Uploaded bill photo path |
| ai_extracted_data | JSON | KAI extracted items from image |
| ai_verification_status | ENUM('pending','verified','mismatch','corrected') | |
| ai_verification_result | JSON | Match/mismatch details |
| verified_at | TIMESTAMP NULL | |
| verified_by | INT NULL | Staff who accepted |
| entered_by | INT | Staff who created |
| notes | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `vendor_bill_items`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| bill_id | INT FK | → vendor_bills |
| zoho_item_id | VARCHAR(50) NULL | Matched Zoho item |
| item_name | VARCHAR(255) | |
| quantity | DECIMAL(10,2) | |
| unit_price | DECIMAL(10,2) | |
| line_total | DECIMAL(12,2) | |
| ai_matched | BOOLEAN DEFAULT FALSE | Was this auto-matched by AI |
| ai_confidence | DECIMAL(3,2) NULL | Match confidence 0-1 |

#### `vendor_purchase_orders`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| po_number | VARCHAR(20) | `PO-YYYYMMDD-001` |
| vendor_id | INT FK | → vendors |
| created_by | INT | Staff user_id |
| subtotal | DECIMAL(12,2) | |
| tax_amount | DECIMAL(12,2) | |
| grand_total | DECIMAL(12,2) | |
| status | ENUM('draft','sent','received','cancelled') | |
| zoho_po_id | VARCHAR(50) NULL | |
| expected_date | DATE | |
| notes | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

#### `vendor_po_items`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| po_id | INT FK | → vendor_purchase_orders |
| zoho_item_id | VARCHAR(50) | |
| item_name | VARCHAR(255) | |
| quantity | DECIMAL(10,2) | |
| unit_price | DECIMAL(10,2) | |
| line_total | DECIMAL(12,2) | |

#### `vendor_payments`

| Column | Type | Purpose |
|--------|------|---------|
| id | INT PK AUTO_INCREMENT | |
| vendor_id | INT FK | → vendors |
| bill_id | INT NULL FK | → vendor_bills |
| amount | DECIMAL(12,2) | |
| payment_method | ENUM('bank_transfer','cheque','upi','cash') | |
| payment_reference | VARCHAR(100) | |
| payment_date | DATE | |
| paid_by | INT | Staff user_id |
| zoho_payment_id | VARCHAR(50) NULL | |
| notes | TEXT | |
| created_at | TIMESTAMP | |

### API Routes — `routes/vendors.js`

**Vendors:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/vendors` | `vendors.view` | List vendors |
| GET | `/api/vendors/:id` | `vendors.view` | Vendor detail |
| POST | `/api/vendors` | `vendors.manage` | Create vendor |
| PUT | `/api/vendors/:id` | `vendors.manage` | Edit vendor |
| POST | `/api/vendors/sync-zoho` | `vendors.manage` | Sync vendors from Zoho |

**Bills:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/vendors/bills` | `vendors.view` | List bills |
| GET | `/api/vendors/bills/:id` | `vendors.view` | Bill detail |
| POST | `/api/vendors/bills` | `vendors.manage` | Create bill |
| PUT | `/api/vendors/bills/:id` | `vendors.manage` | Edit bill |
| POST | `/api/vendors/bills/scan` | `vendors.manage` | Upload photo → KAI extract → auto-match |
| PUT | `/api/vendors/bills/:id/items` | `vendors.manage` | Edit items after AI fill |
| POST | `/api/vendors/bills/:id/verify` | `vendors.manage` | AI verify entry vs image |
| POST | `/api/vendors/bills/:id/submit` | `vendors.manage` | Submit verified bill |
| POST | `/api/vendors/bills/:id/push-zoho` | `vendors.purchase_orders` | Push bill to Zoho |

**Purchase Orders:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/vendors/purchase-orders` | `vendors.view` | List POs |
| POST | `/api/vendors/purchase-orders` | `vendors.purchase_orders` | Create PO |
| PUT | `/api/vendors/purchase-orders/:id` | `vendors.purchase_orders` | Edit PO |
| POST | `/api/vendors/purchase-orders/:id/send` | `vendors.purchase_orders` | Send to vendor |
| POST | `/api/vendors/purchase-orders/:id/push-zoho` | `vendors.purchase_orders` | Push PO to Zoho |

**Payments:**

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/vendors/payments` | `vendors.view` | List payments |
| POST | `/api/vendors/payments` | `vendors.manage` | Record payment |

### Vendor Permissions

| Role | vendors.view | vendors.manage | vendors.purchase_orders |
|------|-------------|---------------|----------------------|
| Staff | Yes | No | No |
| Manager | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes |

### AI Bill Verification — `services/vendor-bill-ai-service.js`

**Scan flow:**
```
1. Upload bill image (Multer saves to uploads/vendor-bills/)
2. Send image to KAI (Clawdbot) with prompt:
   "Extract from this vendor bill: vendor name, bill number, date,
    each line item (product name, quantity, rate, amount), subtotal, tax, total"
3. KAI returns structured JSON
4. For each extracted product:
   a. Fuzzy match against zoho_items_map.zoho_item_name
   b. Check vendor's Zoho purchase history for better matches
   c. Set ai_matched=true, ai_confidence score
5. Return prefilled bill data to frontend
```

**Verify flow:**
```
1. Compare staff-entered items vs ai_extracted_data
2. Check: item names match, quantities match, rates match, totals match
3. Return verification result:
   - verified: all match
   - mismatch: list of differences with field-level detail
4. Staff corrects → re-verify → submit
```

### UI — `public/staff-vendors.html`

**Four tabs:** Vendors | Bills | Purchase Orders | Payments

**Vendors tab:** List + add/edit vendor details
**Bills tab:** List + AI-powered bill entry flow (upload → scan → edit → verify → submit)
**Purchase Orders tab:** Create/track POs, send to vendor, push to Zoho
**Payments tab:** Record vendor payments, aging report

---

## New Files

**Backend:**
- `routes/billing.js` — Estimate + Invoice + Payment endpoints
- `routes/vendors.js` — Vendor CRUD + Bills + PO endpoints
- `services/billing-zoho-service.js` — Shared Zoho push logic
- `services/vendor-bill-ai-service.js` — KAI bill scan + verify + product match
- `config/billing-uploads.js` — Multer config for bill photos
- `migrations/migrate-billing.js` — billing_* tables
- `migrations/migrate-vendors.js` — vendor_* tables

**Frontend:**
- `public/staff-billing.html` — Estimates + Invoices + Payments
- `public/staff-vendors.html` — Vendor management

**Modify:**
- `server.js` — Register billing + vendor routes
- `services/zoho-api.js` — Add `createBill()`, `getBills()`, `createPurchaseOrder()` methods
- `config/uploads.js` — Add vendor bill upload config

## Architecture

```
staff-billing.html ──→ routes/billing.js
                            ├── billing-zoho-service.js ──→ zoho-api.js ──→ Zoho Books
                            ├── painter-points-engine.js (reuse for painter billing)
                            └── DB (billing_* tables)

staff-vendors.html ──→ routes/vendors.js
                            ├── vendor-bill-ai-service.js ──→ KAI (Clawdbot)
                            ├── billing-zoho-service.js ──→ zoho-api.js
                            └── DB (vendor_* tables)
```
