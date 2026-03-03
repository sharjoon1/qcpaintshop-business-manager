# Card & Estimate System Upgrade Design

**Date**: 2026-03-03
**Scope**: Card visual improvements, estimate professional view, admin markup % + discount flow

---

## Feature A: Card Logo & Text Improvements

### Visiting Card (1400x800)
- Logo size: 180px → 250px
- White circle backdrop behind logo (opacity 0.15) for visibility
- Name text centered with improved letter-spacing
- Gold underline wider, diamond accents
- Phone pill more prominent

### ID Card (800x1200)
- Logo size: 130px → 180px
- Same white circle backdrop
- Matching text improvements

## Feature B: Share Loading Spinner

- On share button click: show full-screen loading overlay with spinner
- Hide on: share dialog opens, error, or 10s timeout
- Applies to both visiting card and ID card share

## Feature C: Professional Estimate View + Share

Transform estimate modal into billing-software-style view:
- QC logo + "Quality Colours" header (for customer estimates)
- Estimate number, date, customer/painter details
- Professional table with borders (Product, Description, Qty, Rate, Amount)
- Subtotal, discount (if any), grand total
- "Share via WhatsApp" button → uses existing share page link
- "Print/Download" option

## Feature D: Admin Markup — Zoho Description + Percentage

### Current
- Shows `item_name` from `painter_estimate_items`
- Admin enters absolute `markup_unit_price`

### New
- Show Zoho `item_description` (JOIN `zoho_items_map` on `zoho_item_id`)
- Per-item % markup input (auto-calculates `markup_unit_price` from `unit_price`)
- Bulk % input at top → applies to all items
- Both % and absolute price editable (changing one updates the other)

## Feature E: Discount Request Flow

### New Status: `discount_requested`, `final_approved`

### DB Changes (migration)
- `painter_estimates`: add columns:
  - `discount_percentage` DECIMAL(5,2) DEFAULT NULL
  - `discount_amount` DECIMAL(10,2) DEFAULT NULL
  - `final_grand_total` DECIMAL(10,2) DEFAULT NULL
  - `discount_requested_at` TIMESTAMP NULL
  - `discount_notes` TEXT NULL
  - `discount_approved_by` INT NULL
  - `discount_approved_at` TIMESTAMP NULL
- ALTER status ENUM: add `discount_requested`, `final_approved`

### Workflow
```
CUSTOMER BILLING (with discount):
approved → sent_to_customer → [painter clicks "Request Discount"]
  → discount_requested → [admin applies discount %] → final_approved
  → [painter records payment] → payment_recorded
  → [admin pushes to Zoho] → pushed_to_zoho

CUSTOMER BILLING (no discount):
approved → sent_to_customer → [admin records payment]
  → payment_recorded → pushed_to_zoho

SELF BILLING (unchanged):
pending_admin → approved → payment_recorded → pushed_to_zoho
```

### Painter Side
- Approved/sent_to_customer estimates: "Request Discount" button
- After final_approved: "Record Payment" button with method/reference inputs
- Payment recording by painter (not just admin)

### Admin Side
- Discount request indicator (badge/highlight)
- Admin enters discount % → system calculates discount_amount from markup_grand_total
- "Apply Discount & Approve" button
- Shows final_grand_total after discount

## Feature F: Zoho Push Enhancement

- Use `final_grand_total` (post-discount) if available, else `markup_grand_total`
- Invoice line items use discounted rates
- Contact: customer name (customer billing) or painter name (self billing)
- Already implemented — just needs discount-aware pricing
