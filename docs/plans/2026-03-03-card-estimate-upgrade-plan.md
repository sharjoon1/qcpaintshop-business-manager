# Card & Estimate System Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade card visuals (bigger logo with backdrop, better text), add share loading spinner, professional estimate view with share, admin % markup with Zoho descriptions, and discount request workflow.

**Architecture:** Card generator changes are Sharp SVG modifications. Dashboard changes are vanilla JS/HTML in painter-dashboard.html. Admin estimate improvements touch admin-painters.html + routes/painters.js. New discount flow requires a DB migration adding columns + new status values, new endpoints, and UI on both painter and admin sides.

**Tech Stack:** Node.js/Express, Sharp (SVG→PNG), MySQL, vanilla JS/HTML, Zoho Books API

---

### Task 1: Card Logo & Text Improvements

**Files:**
- Modify: `services/painter-card-generator.js:37-46` (loadLogo), `:78-81` (visiting card logo size), `:130-169` (visiting card SVG text), `:179` (visiting card logo composite), `:198-201` (ID card logo size), `:245-282` (ID card SVG text), `:292` (ID card logo composite)

**Step 1: Increase logo size and add backdrop**

In `generateCard()` (visiting card):
- Change `logoSz = 180` → `logoSz = 250` (line 78)
- Add white semi-transparent circle behind logo in SVG: `<circle cx="165" cy="90" r="140" fill="white" opacity="0.12"/>`
- Update composite position: `top: 0, left: 40` → `top: -35, left: 40` (to accommodate larger logo)

In `generateIdCard()` (ID card):
- Change `logoSz = 130` → `logoSz = 180` (line 198)
- Add white semi-transparent circle behind logo in SVG: `<circle cx="105" cy="100" r="100" fill="white" opacity="0.12"/>`
- Update composite position from `top: 8, left: 16` → `top: 2, left: 10`

**Step 2: Improve text styling on visiting card**

- Painter name (line 138): Add `letter-spacing="2"` and duplicate shadow text with offset
- Gold underline: Make wider (from ±150 to ±200), add round linecap
- Phone pill: Increase to 440px wide, font from 42px to 46px
- Ensure all main content text is `text-anchor="middle"` centered on `cx`

**Step 3: Improve text styling on ID card**

- Painter name (line 250): Add `letter-spacing="1.5"`
- Referral code box: Slightly larger padding, gold border thicker (3px)
- Company header: Increase "QUALITY COLOURS" from 42px to 46px

**Step 4: Test by regenerating cards on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node -e \"
require('dotenv').config();
const { createPool } = require('./config/database');
const pool = createPool();
const { generateCard, generateIdCard } = require('./services/painter-card-generator');
(async () => {
  const [painters] = await pool.query('SELECT id, full_name, phone, city, profile_photo FROM painters WHERE status = \\\"approved\\\"');
  for (const p of painters) {
    await generateCard(p, pool);
    await generateIdCard(p, pool);
    await pool.query('UPDATE painters SET card_generated_at = NOW() WHERE id = ?', [p.id]);
    console.log('Done:', p.full_name);
  }
  process.exit(0);
})();
\""
```

**Step 5: Commit**

```bash
git add services/painter-card-generator.js
git commit -m "feat: card v6 — bigger logo with backdrop, improved text styling"
```

---

### Task 2: Share Button Loading Spinner

**Files:**
- Modify: `public/painter-dashboard.html:1155-1214` (shareCardFile function), `:228-241` (share buttons)

**Step 1: Add loading overlay HTML and CSS**

Add to CSS section of painter-dashboard.html:
```css
.share-loading-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); z-index: 9999;
    display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px;
}
.share-spinner {
    width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3);
    border-top-color: #D4A24E; border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

Add HTML overlay element near the modals section.

**Step 2: Modify shareCardFile() to show/hide loading**

At start of `shareCardFile()`: create and append loading overlay.
On completion (success, error, or abort): remove overlay.
Add 10s timeout safety net to auto-remove.

**Step 3: Test share buttons in browser**

Click both share buttons, verify spinner appears and disappears.

**Step 4: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat: add loading spinner for card share buttons"
```

---

### Task 3: Professional Estimate View + Share on Painter Dashboard

**Files:**
- Modify: `public/painter-dashboard.html:1027-1075` (viewPainterEstimate function), `:210-216` (estimateModal HTML)

**Step 1: Redesign viewPainterEstimate() as professional invoice view**

Transform the modal content to look like a billing software estimate:
- QC logo header (for customer billing: "Quality Colours" + address)
- Estimate number + date in header row
- Customer/painter info section
- Professional bordered table: # | Product | Qty | Rate | Amount
- Subtotal, discount (if any), grand total in right-aligned summary
- "Share via WhatsApp" button at bottom (uses existing share page URL)
- "Close" button

**Step 2: Add share estimate functionality**

For customer-billing estimates that have a share token:
- "Share via WhatsApp" button generates WhatsApp deep link with share page URL
- For estimates without share token: hide share button (only admin can generate token)

For self-billing estimates:
- No share button (self billing is internal)

**Step 3: Add "Request Discount" and "Record Payment" buttons**

- For `approved` or `sent_to_customer` status: show "Request Discount" button
- For `final_approved` status: show "Record Payment" form (method, reference, amount)
- These will connect to the new endpoints created in Task 5

**Step 4: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat: professional estimate view with share and payment options"
```

---

### Task 4: DB Migration for Discount Flow

**Files:**
- Create: `migrations/migrate-estimate-discount.js`

**Step 1: Write the migration script**

```javascript
// migrations/migrate-estimate-discount.js
require('dotenv').config();
const { createPool } = require('../config/database');

async function migrate() {
    const pool = createPool();
    try {
        console.log('Adding discount columns to painter_estimates...');

        // Add new columns
        const cols = [
            "ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT NULL AFTER markup_grand_total",
            "ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT NULL AFTER discount_percentage",
            "ADD COLUMN IF NOT EXISTS final_grand_total DECIMAL(10,2) DEFAULT NULL AFTER discount_amount",
            "ADD COLUMN IF NOT EXISTS discount_requested_at TIMESTAMP NULL AFTER final_grand_total",
            "ADD COLUMN IF NOT EXISTS discount_notes TEXT NULL AFTER discount_requested_at",
            "ADD COLUMN IF NOT EXISTS discount_approved_by INT NULL AFTER discount_notes",
            "ADD COLUMN IF NOT EXISTS discount_approved_at TIMESTAMP NULL AFTER discount_approved_by"
        ];

        for (const col of cols) {
            try {
                await pool.query(`ALTER TABLE painter_estimates ${col}`);
                console.log('  Added:', col.split(' ')[4]);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') console.log('  Exists:', col.split(' ')[4]);
                else throw e;
            }
        }

        // Expand status ENUM to include new states
        console.log('Expanding status ENUM...');
        await pool.query(`
            ALTER TABLE painter_estimates MODIFY COLUMN status
            ENUM('draft','pending_admin','admin_review','approved','sent_to_customer',
                 'discount_requested','final_approved','payment_recorded','pushed_to_zoho',
                 'rejected','cancelled') NOT NULL DEFAULT 'draft'
        `);

        console.log('Migration complete!');
    } catch (e) {
        console.error('Migration failed:', e.message);
    } finally {
        await pool.end();
    }
}

migrate();
```

**Step 2: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-estimate-discount.js"
```

**Step 3: Commit**

```bash
git add migrations/migrate-estimate-discount.js
git commit -m "feat: migration for estimate discount flow columns + status enum"
```

---

### Task 5: Backend — Admin Markup with % + Discount Endpoints

**Files:**
- Modify: `routes/painters.js:2527-2548` (GET /estimates/:estimateId — add zoho_description JOIN), `:2602-2645` (POST markup — add % support), `:2681-2707` (POST payment — accept new statuses)

**Step 1: Update GET /estimates/:estimateId to include zoho_description**

In the items query (line ~2540), JOIN with zoho_items_map:
```sql
SELECT pei.*, zim.zoho_description, zim.zoho_item_name as zoho_display_name
FROM painter_estimate_items pei
LEFT JOIN zoho_items_map zim ON pei.zoho_item_id = zim.zoho_item_id
WHERE pei.estimate_id = ?
ORDER BY pei.display_order
```

**Step 2: Update POST /estimates/:estimateId/markup to accept percentage**

Accept two new fields: `markup_percentage` (bulk % for all items) and items with optional `markup_pct` per item.

Logic:
- If `markup_percentage` is provided: apply that % to all items (unit_price * (1 + pct/100))
- If individual item has `markup_pct`: that overrides bulk %
- If individual item has `markup_unit_price`: use that directly (absolute price)
- Calculate `markup_line_total = markup_unit_price * quantity`

**Step 3: Add new endpoint: POST /estimates/:estimateId/discount**

New endpoint for admin to apply discount:
```javascript
router.post('/estimates/:estimateId/discount', requirePermission('painters', 'estimates'), async (req, res) => {
    // Only for discount_requested status
    // Body: { discount_percentage }
    // Calculate: discount_amount = markup_grand_total * (discount_percentage / 100)
    // Set: final_grand_total = markup_grand_total - discount_amount
    // Update status to 'final_approved'
    // Store discount_approved_by, discount_approved_at
});
```

**Step 4: Add new endpoint: POST /me/estimates/:estimateId/request-discount**

Painter-auth endpoint to request discount:
```javascript
router.post('/me/estimates/:estimateId/request-discount', requirePainterAuth, async (req, res) => {
    // Only for approved or sent_to_customer status, customer billing only
    // Body: { notes } (optional reason)
    // Update status to 'discount_requested'
    // Set discount_requested_at = NOW(), discount_notes
});
```

**Step 5: Add painter payment endpoint: POST /me/estimates/:estimateId/payment**

```javascript
router.post('/me/estimates/:estimateId/payment', requirePainterAuth, async (req, res) => {
    // Only for final_approved status
    // Body: { payment_method, payment_reference, payment_amount }
    // Same logic as admin payment but painter-side
    // Update status to 'payment_recorded'
});
```

**Step 6: Update existing payment endpoint to accept final_approved status**

In POST /estimates/:estimateId/payment (line 2681), add `final_approved` to accepted statuses.

**Step 7: Update Zoho push to use final_grand_total**

In POST /estimates/:estimateId/push-zoho, when building invoice line items:
- If `final_grand_total` exists and discount was applied: use discounted rate per item
- Rate per item = `markup_unit_price * (1 - discount_percentage/100)`

**Step 8: Commit**

```bash
git add routes/painters.js
git commit -m "feat: admin % markup, discount request/apply endpoints, painter payment"
```

---

### Task 6: Admin UI — Zoho Description + % Markup + Discount Management

**Files:**
- Modify: `public/admin-painters.html:1537-1564` (renderEstimatesTable), `:1590-1700` (viewEstimate detail modal), `:1714-1733` (saveMarkupPrices), `:1598-1618` (action buttons)

**Step 1: Show zoho_description in estimate detail items table**

Replace `item_name` column header with "Product / Description".
Show `zoho_description` (or fall back to `item_name`) in items table.

**Step 2: Add % markup inputs**

In the detail modal for `admin_review` status:
- Add "Bulk Markup %" input at top of items table
- Per-item: add "%" input next to the absolute price input
- Changing % auto-calculates price; changing price auto-calculates %
- "Apply to All" button applies bulk % to all items

**Step 3: Add discount management**

For `discount_requested` status:
- Show discount request notification (yellow highlight)
- Show "Discount %" input
- Show calculated discount amount and final total
- "Apply Discount & Approve" button → calls POST /estimates/:id/discount

For `final_approved` status:
- Show discount info (% and amount)
- Show final grand total
- Payment and Zoho push buttons remain

**Step 4: Update status filter dropdown**

Add `discount_requested` and `final_approved` to the status filter options.

**Step 5: Update action buttons for new statuses**

```javascript
} else if (est.status === 'discount_requested') {
    actionsHtml = `<button class="btn-sm btn-primary" onclick="showDiscountForm(${est.id})">Apply Discount</button>`;
} else if (est.status === 'final_approved') {
    actionsHtml = `<button class="btn-sm btn-success" onclick="showPaymentForm(${est.id})">Record Payment</button>`;
}
```

**Step 6: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat: admin zoho description, % markup, discount management UI"
```

---

### Task 7: Deploy & Test End-to-End

**Step 1: Push and deploy**

```bash
git push origin master
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

**Step 2: Regenerate cards on server**

Run the card regeneration script from Task 1.

**Step 3: Test card improvements**
- Check visiting card: logo bigger with white backdrop, text centered
- Check ID card: logo bigger with white backdrop
- Share both cards: verify loading spinner appears

**Step 4: Test estimate flow**
- Create customer billing estimate as painter
- Admin: verify zoho_description shows, apply % markup
- Share estimate with customer
- Painter: request discount
- Admin: apply discount, approve final
- Painter: record payment
- Admin: push to Zoho

**Step 5: Update Skills.md and MEMORY.md**

**Step 6: Final commit**

```bash
git add Skills.md
git commit -m "docs: update Skills.md with card v6 and estimate discount flow"
```
