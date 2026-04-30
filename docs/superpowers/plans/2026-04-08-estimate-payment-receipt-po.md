# Estimate Payment Receipt + Vendor PO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add payment recording, receipt generation + WhatsApp send, and auto-create vendor purchase orders from the estimate-view page.

**Architecture:** Extend `estimates` table with payment columns. Add `POST /:id/record-payment` endpoint that records payment, auto-creates billing invoice, generates receipt PDF, and sends via WhatsApp. Add `POST /:id/create-po` endpoint that creates vendor PO from estimate items with 3rd-party delivery flag. Frontend adds "Record Payment" and "Create PO" buttons to estimate-view.html with modals.

**Tech Stack:** Express.js, MySQL/MariaDB, Puppeteer (PDF), whatsapp-web.js (send), QRCode (UPI)

**Spec:** Approved in conversation — Payment receipt flow + Vendor PO from estimate + 3rd party billing

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `migrations/migrate-estimate-payment-po.js` | Add payment columns to estimates, add delivery_address to vendor_purchase_orders |
| `public/payment-receipt.html` | Payment receipt print/PDF page (Puppeteer renders this) |

### Modified Files
| File | Change |
|------|--------|
| `routes/estimates.js` | Add POST /:id/record-payment, POST /:id/create-po endpoints |
| `public/estimate-view.html` | Add "Record Payment" + "Create PO" buttons, payment modal, PO modal |

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-estimate-payment-po.js`

- [ ] **Step 1: Create migration file**

```javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

async function migrate() {
    console.log('=== Estimate Payment + PO Migration ===');

    // Add payment columns to estimates table
    const paymentCols = [
        "ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid'",
        "ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)",
        "ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(12,2) DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS payment_recorded_by INT",
        "ADD COLUMN IF NOT EXISTS payment_recorded_at DATETIME",
        "ADD COLUMN IF NOT EXISTS billing_invoice_id INT",
        "ADD INDEX IF NOT EXISTS idx_payment_status (payment_status)"
    ];
    for (const col of paymentCols) {
        try {
            await pool.query(`ALTER TABLE estimates ${col}`);
        } catch (e) {
            if (!e.message.includes('Duplicate')) console.warn('Skip:', col, e.message);
        }
    }
    console.log('Added payment columns to estimates');

    // Add delivery columns to vendor_purchase_orders
    const poCols = [
        "ADD COLUMN IF NOT EXISTS estimate_id INT",
        "ADD COLUMN IF NOT EXISTS delivery_name VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(20)",
        "ADD COLUMN IF NOT EXISTS delivery_address TEXT",
        "ADD COLUMN IF NOT EXISTS is_third_party BOOLEAN DEFAULT false",
        "ADD INDEX IF NOT EXISTS idx_estimate (estimate_id)"
    ];
    for (const col of poCols) {
        try {
            await pool.query(`ALTER TABLE vendor_purchase_orders ${col}`);
        } catch (e) {
            if (!e.message.includes('Duplicate')) console.warn('Skip:', col, e.message);
        }
    }
    console.log('Added delivery columns to vendor_purchase_orders');

    console.log('=== Migration Complete ===');
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

- [ ] **Step 2: Run migration**

Run: `node migrations/migrate-estimate-payment-po.js`

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-estimate-payment-po.js
git commit -m "feat(estimates): add payment + PO delivery columns migration"
```

---

## Task 2: Payment Receipt HTML Page

**Files:**
- Create: `public/payment-receipt.html`

- [ ] **Step 1: Create receipt page**

This page is rendered by Puppeteer to generate receipt PDFs. It loads estimate + payment data via API and renders a receipt.

Structure:
- Company header (Quality Colours logo + address)
- "PAYMENT RECEIPT" title
- Receipt details: Date, Estimate #, Customer name/phone/address
- Items table from estimate (item name, qty, price, total)
- Payment summary: Grand Total, Amount Paid, Balance Due
- Payment method + reference
- UPI QR code for balance (if any)
- Footer: "Thank you for your business!"

The page should:
- Accept URL params: `?id={estimateId}&token={authToken}&mode=pdf`
- Fetch estimate data from `/api/estimates/{id}` with auth token
- Display payment info from the estimate's payment fields
- Be styled for A4 print (similar to estimate-print.html)
- Use Tailwind CDN for styling

Key sections:
```html
<div id="receiptContent" class="max-w-2xl mx-auto p-8 bg-white">
    <!-- Company Header -->
    <!-- PAYMENT RECEIPT title with receipt number -->
    <!-- Customer Details: Name, Phone, Address -->
    <!-- Items Table: same as estimate items -->
    <!-- Payment Summary: Grand Total, Paid, Balance -->
    <!-- Payment Details: Method, Reference, Date -->
    <!-- UPI QR (if balance > 0) -->
    <!-- Footer -->
</div>
```

The implementer should READ `public/estimate-print.html` for styling patterns and structure, then create a similar page focused on payment receipt display.

- [ ] **Step 2: Commit**

```bash
git add public/payment-receipt.html
git commit -m "feat(estimates): add payment receipt HTML page for PDF generation"
```

---

## Task 3: Backend — Record Payment + Create PO Endpoints

**Files:**
- Modify: `routes/estimates.js`

- [ ] **Step 1: Add POST /:id/record-payment endpoint**

Place BEFORE the `GET /:id` catch-all route (near the existing `/:id/send-whatsapp` endpoint).

```javascript
// POST /:id/record-payment — Record payment, create invoice, generate receipt, send WhatsApp
router.post('/:id/record-payment', requireAuth, async (req, res) => {
    try {
        const { amount, payment_method, payment_reference, send_whatsapp, phone } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Valid amount required' });
        if (!payment_method) return res.status(400).json({ success: false, message: 'Payment method required' });

        // Get estimate
        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];
        const grandTotal = parseFloat(est.grand_total) || 0;

        // Calculate payment
        const prevPaid = parseFloat(est.payment_amount) || 0;
        const newTotalPaid = prevPaid + parseFloat(amount);
        const balanceDue = Math.max(0, grandTotal - newTotalPaid);
        const paymentStatus = balanceDue <= 0.01 ? 'paid' : (newTotalPaid > 0 ? 'partial' : 'unpaid');

        // Update estimate payment fields
        await pool.query(`
            UPDATE estimates SET payment_amount = ?, payment_status = ?, payment_method = ?,
                payment_reference = ?, payment_recorded_by = ?, payment_recorded_at = NOW()
            WHERE id = ?
        `, [newTotalPaid, paymentStatus, payment_method, payment_reference || null, req.user.id, req.params.id]);

        // Auto-create billing invoice if not exists
        let invoiceId = est.billing_invoice_id;
        if (!invoiceId) {
            // Get estimate items
            const [items] = await pool.query('SELECT * FROM estimate_items WHERE estimate_id = ?', [req.params.id]);

            // Generate invoice number
            const [[{ cnt }]] = await pool.query("SELECT COUNT(*) as cnt FROM billing_invoices WHERE DATE(created_at) = CURDATE()");
            const invoiceNumber = `BI-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(cnt + 1).padStart(3,'0')}`;

            const [invResult] = await pool.query(`
                INSERT INTO billing_invoices (invoice_number, source, customer_name, customer_phone, customer_address,
                    subtotal, discount_amount, grand_total, amount_paid, balance_due, payment_status, estimate_id, created_by)
                VALUES (?, 'estimate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [invoiceNumber, est.customer_name, est.customer_phone, est.customer_address,
                est.subtotal || grandTotal, est.total_discount || 0, grandTotal,
                newTotalPaid, balanceDue, paymentStatus, req.params.id, req.user.id]);

            invoiceId = invResult.insertId;

            // Copy estimate items to invoice items
            for (const item of items) {
                await pool.query(`
                    INSERT INTO billing_invoice_items (invoice_id, item_name, brand, quantity, unit_price, line_total)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [invoiceId, item.item_name, item.brand, item.quantity, item.unit_price || item.final_price, item.line_total]);
            }

            // Link invoice to estimate
            await pool.query('UPDATE estimates SET billing_invoice_id = ?, status = ? WHERE id = ?',
                [invoiceId, 'converted', req.params.id]);
        } else {
            // Update existing invoice payment
            await pool.query(`
                UPDATE billing_invoices SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?
            `, [newTotalPaid, balanceDue, paymentStatus, invoiceId]);
        }

        // Record payment in billing_payments
        await pool.query(`
            INSERT INTO billing_payments (invoice_id, amount, payment_method, payment_reference, received_by, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [invoiceId, amount, payment_method, payment_reference || null, req.user.id,
            `Payment for Estimate #${est.estimate_number}`]);

        // Generate receipt PDF and send via WhatsApp if requested
        let whatsappSent = false;
        if (send_whatsapp && phone) {
            try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');

                // Generate receipt PDF via Puppeteer
                const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '';
                const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
                const pdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf?receipt=1`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                // Fallback: use estimate PDF if receipt PDF not available
                let pdfBuffer;
                if (pdfResp.ok) {
                    pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
                } else {
                    const estPdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (estPdfResp.ok) pdfBuffer = Buffer.from(await estPdfResp.arrayBuffer());
                }

                if (pdfBuffer) {
                    const tmpDir = path.join(os.tmpdir(), 'qc-receipts');
                    fs.mkdirSync(tmpDir, { recursive: true });
                    const receiptPath = path.join(tmpDir, `Receipt-${est.estimate_number}.pdf`);
                    fs.writeFileSync(receiptPath, pdfBuffer);

                    const sessionManager = require('../services/whatsapp-session-manager');
                    const paidAmt = parseFloat(amount).toLocaleString('en-IN');
                    const totalAmt = grandTotal.toLocaleString('en-IN');
                    const caption = `Dear ${est.customer_name || 'Customer'},\n\n✅ *Payment Received!*\n\nEstimate: *#${est.estimate_number}*\nAmount Paid: *₹${paidAmt}*\nTotal: *₹${totalAmt}*\nBalance: *₹${balanceDue.toLocaleString('en-IN')}*\nMethod: ${payment_method.toUpperCase()}${payment_reference ? '\nRef: ' + payment_reference : ''}\n\nThank you! 🙏\n_Quality Colours_`;

                    try {
                        await sessionManager.sendMedia(-1, phone, {
                            type: 'document', mediaPath: receiptPath,
                            caption, filename: `Receipt-${est.estimate_number}.pdf`
                        }, { source: 'payment-receipt', sent_by: req.user.id });
                        whatsappSent = true;
                    } catch (e) {
                        await sessionManager.sendMedia(0, phone, {
                            type: 'document', mediaPath: receiptPath,
                            caption, filename: `Receipt-${est.estimate_number}.pdf`
                        }, { source: 'payment-receipt', sent_by: req.user.id }).catch(() => {});
                        whatsappSent = true;
                    }

                    try { fs.unlinkSync(receiptPath); } catch (e) {}
                }
            } catch (waErr) {
                console.error('WhatsApp receipt send error:', waErr.message);
            }
        }

        res.json({
            success: true,
            data: {
                payment_status: paymentStatus,
                amount_paid: newTotalPaid,
                balance_due: balanceDue,
                invoice_id: invoiceId,
                whatsapp_sent: whatsappSent
            }
        });
    } catch (err) {
        console.error('Record payment error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to record payment' });
    }
});
```

- [ ] **Step 2: Add POST /:id/create-po endpoint**

Place after the record-payment endpoint, still BEFORE `GET /:id`.

```javascript
// POST /:id/create-po — Create vendor purchase order from estimate
router.post('/:id/create-po', requireAuth, async (req, res) => {
    try {
        const { vendor_id, send_whatsapp, vendor_phone, notes } = req.body;
        if (!vendor_id) return res.status(400).json({ success: false, message: 'Vendor is required' });

        // Get estimate with items
        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];

        const [items] = await pool.query('SELECT * FROM estimate_items WHERE estimate_id = ? AND item_type = ?', [req.params.id, 'product']);
        if (!items.length) return res.status(400).json({ success: false, message: 'No product items in estimate' });

        // Generate PO number
        const [[{ cnt }]] = await pool.query("SELECT COUNT(*) as cnt FROM vendor_purchase_orders WHERE DATE(created_at) = CURDATE()");
        const poNumber = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(cnt + 1).padStart(3,'0')}`;

        // Calculate totals from items using base_price (purchase cost, not selling price)
        const subtotal = items.reduce((sum, it) => sum + ((parseFloat(it.base_price) || parseFloat(it.unit_price) || 0) * (it.quantity || 1)), 0);
        const grandTotal = subtotal; // No extra tax on PO — DPL prices

        // Create PO with 3rd party delivery
        const [poResult] = await pool.query(`
            INSERT INTO vendor_purchase_orders
                (po_number, vendor_id, estimate_id, subtotal, tax_amount, grand_total,
                 delivery_name, delivery_phone, delivery_address, is_third_party,
                 expected_date, notes, status, created_by)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, true, DATE_ADD(NOW(), INTERVAL 3 DAY), ?, 'draft', ?)
        `, [poNumber, vendor_id, req.params.id, subtotal, grandTotal,
            est.customer_name, est.customer_phone, est.customer_address,
            notes || `PO from Estimate #${est.estimate_number}`, req.user.id]);

        const poId = poResult.insertId;

        // Insert PO items (use base_price as purchase cost)
        for (const item of items) {
            const unitPrice = parseFloat(item.base_price) || parseFloat(item.unit_price) || 0;
            await pool.query(`
                INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [poId, item.zoho_item_id, item.item_name, item.quantity || 1, unitPrice, unitPrice * (item.quantity || 1)]);
        }

        // Send PO to vendor via WhatsApp if requested
        let whatsappSent = false;
        if (send_whatsapp && vendor_phone) {
            try {
                const sessionManager = require('../services/whatsapp-session-manager');
                const poMsg = `*Purchase Order #${poNumber}*\n\nFrom: *Quality Colours*\nFor Estimate: #${est.estimate_number}\n\n*Items:*\n${items.map(it => `• ${it.item_name} x${it.quantity || 1}`).join('\n')}\n\n*Total: ₹${grandTotal.toLocaleString('en-IN')}*\n\n📦 *3rd Party Delivery:*\n${est.customer_name}\n${est.customer_phone}\n${est.customer_address || 'Address to be confirmed'}\n\nPlease confirm and deliver.\nThank you!`;

                try {
                    await sessionManager.sendMessage(-1, vendor_phone, poMsg, { source: 'purchase-order', sent_by: req.user.id });
                    whatsappSent = true;
                } catch (e) {
                    await sessionManager.sendMessage(0, vendor_phone, poMsg, { source: 'purchase-order', sent_by: req.user.id }).catch(() => {});
                    whatsappSent = true;
                }

                // Update PO status to sent
                await pool.query("UPDATE vendor_purchase_orders SET status = 'sent' WHERE id = ?", [poId]);
            } catch (waErr) {
                console.error('WhatsApp PO send error:', waErr.message);
            }
        }

        res.json({
            success: true,
            data: {
                po_id: poId,
                po_number: poNumber,
                grand_total: grandTotal,
                whatsapp_sent: whatsappSent
            }
        });
    } catch (err) {
        console.error('Create PO error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to create PO' });
    }
});
```

- [ ] **Step 3: Add GET /vendors/list quick endpoint for frontend dropdown**

Check if there's already a way to get vendor list for dropdowns. The vendors routes are at `/api/vendors`. The frontend will need to fetch vendors for the PO modal dropdown. The existing `GET /api/vendors` endpoint should work — verify it returns vendor_id, vendor_name, phone.

- [ ] **Step 4: Commit**

```bash
git add routes/estimates.js
git commit -m "feat(estimates): add record-payment + create-po endpoints with WhatsApp send"
```

---

## Task 4: Frontend — Payment Modal + PO Modal on estimate-view.html

**Files:**
- Modify: `public/estimate-view.html`

- [ ] **Step 1: Add action buttons**

READ `public/estimate-view.html` first. Find the action buttons bar (around lines 65-103). Add two new buttons before the WhatsApp button:

```html
<button onclick="openPaymentModal()" id="btnRecordPayment"
    class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
    title="Record Payment">
    ₹ Payment
</button>
<button onclick="openPoModal()" id="btnCreatePO"
    class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 flex items-center gap-1"
    title="Create Purchase Order">
    📦 PO
</button>
```

- [ ] **Step 2: Add Payment Modal HTML**

Add before `</body>`:

Payment modal with:
- Amount input (pre-filled with grand_total or balance_due)
- Payment method dropdown: UPI, Cash, Bank Transfer, Cheque
- Payment reference input
- Phone number input (pre-filled with customer_phone)
- "Send Receipt via WhatsApp" checkbox (default checked)
- Cancel + "Record Payment" buttons
- Payment status display (current: paid/partial/unpaid, amount paid, balance)

- [ ] **Step 3: Add PO Modal HTML**

PO modal with:
- Vendor dropdown (fetched from /api/vendors)
- Auto-suggested vendor based on item brands (match brand → vendor name)
- Items preview table (from estimate items, showing base_price as purchase cost)
- Delivery section: Customer name, phone, address (pre-filled from estimate)
- "3rd Party Delivery" badge (always on)
- Vendor phone input (for WhatsApp)
- "Send PO via WhatsApp" checkbox
- Notes textarea
- Cancel + "Create PO & Send" buttons

- [ ] **Step 4: Add JavaScript functions**

```javascript
// Payment Modal
function openPaymentModal() {
    // Pre-fill: amount = balance or grand_total, phone = customer_phone
    // Show modal
}

async function recordPayment() {
    // POST /api/estimates/{id}/record-payment
    // On success: update status badge, show toast, close modal
    // If whatsapp checked: receipt sent automatically by backend
}

// PO Modal
async function loadVendors() {
    // GET /api/vendors → populate dropdown
}

function autoSuggestVendor() {
    // Match estimate item brands to vendor names
    // Asian Paints items → vendor with "Asian" in name
    // Berger items → vendor with "Berger" in name
}

function openPoModal() {
    // Pre-fill delivery from estimate customer data
    // Load vendors, auto-suggest
    // Show items with base_price (purchase cost)
}

async function createPurchaseOrder() {
    // POST /api/estimates/{id}/create-po
    // On success: show toast, update UI
}
```

- [ ] **Step 5: Update status badge to show payment status**

After estimate loads, check `estimateData.payment_status`. If paid/partial, show a payment badge next to the estimate status:
- Paid: green "₹ Paid" badge
- Partial: yellow "₹ Partial (₹X/₹Y)" badge

- [ ] **Step 6: Commit**

```bash
git add public/estimate-view.html
git commit -m "feat(estimates): add payment recording + vendor PO creation UI with WhatsApp integration"
```

---

## Task 5: Receipt PDF Route

**Files:**
- Modify: `routes/estimate-pdf.js`

- [ ] **Step 1: Add receipt mode to PDF generation**

READ `routes/estimate-pdf.js`. Find where the Puppeteer URL is built (around line 76). Add support for `?receipt=1` query param:

```javascript
// If receipt mode, render payment-receipt.html instead of estimate-print.html
const pageUrl = req.query.receipt === '1'
    ? `${protocol}://${host}/payment-receipt.html?id=${req.params.id}&token=${token}&mode=pdf`
    : `${protocol}://${host}/estimate-print.html?id=${req.params.id}&mode=pdf&token=${token}`;
```

Also update the filename:
```javascript
const filename = req.query.receipt === '1'
    ? `Receipt-${estimate.estimate_number || req.params.id}.pdf`
    : `Estimate-${estimate.estimate_number || req.params.id}.pdf`;
```

- [ ] **Step 2: Commit**

```bash
git add routes/estimate-pdf.js
git commit -m "feat(estimates): add receipt PDF mode to estimate PDF generator"
```

---

## Task 6: Final Integration + Deploy

- [ ] **Step 1: Run migration on server**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-estimate-payment-po.js && pm2 restart business-manager"
```

- [ ] **Step 2: Test end-to-end**

1. Open estimate-view.html → click "₹ Payment" → record payment → verify receipt sent via WhatsApp
2. Click "📦 PO" → select vendor → verify PO created with 3rd party delivery
3. Verify payment status badge updates
4. Verify billing invoice auto-created

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "feat(estimates): complete payment receipt + vendor PO workflow"
```
