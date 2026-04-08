// routes/estimates.js
// Extracted + enhanced estimate CRUD routes with markup/discount/labor calculation engine
const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

let pool;

function setPool(p) { pool = p; }

// ========================================
// CALCULATION ENGINE
// ========================================
function calculateItemPricing(item) {
    const basePrice = parseFloat(item.base_price) || parseFloat(item.unit_price) || 0;
    const quantity = parseFloat(item.quantity) || 1;
    let markupAmount = 0;
    let priceAfterMarkup = basePrice;
    let discountAmount = 0;

    // Apply markup
    if (item.markup_type && parseFloat(item.markup_value) > 0) {
        const mv = parseFloat(item.markup_value);
        switch (item.markup_type) {
            case 'price_pct':
                markupAmount = basePrice * mv / 100;
                break;
            case 'price_value':
                markupAmount = mv;
                break;
            case 'total_pct':
                markupAmount = (basePrice * quantity) * mv / 100 / quantity;
                break;
            case 'total_value':
                markupAmount = mv / quantity;
                break;
        }
        priceAfterMarkup = basePrice + markupAmount;
    }

    // Apply discount on price_after_markup
    let finalPrice = priceAfterMarkup;
    if (item.discount_type && parseFloat(item.discount_value) > 0) {
        const dv = parseFloat(item.discount_value);
        switch (item.discount_type) {
            case 'price_pct':
                discountAmount = priceAfterMarkup * dv / 100;
                break;
            case 'price_value':
                discountAmount = dv;
                break;
            case 'total_pct':
                discountAmount = (priceAfterMarkup * quantity) * dv / 100 / quantity;
                break;
            case 'total_value':
                discountAmount = dv / quantity;
                break;
        }
        finalPrice = priceAfterMarkup - discountAmount;
    }

    // Round up to nearest 10
    const r10 = n => Math.ceil(n / 10) * 10;
    finalPrice = r10(finalPrice);
    const lineTotal = r10(finalPrice * quantity);

    return {
        base_price: r10(basePrice),
        markup_amount: Math.round(markupAmount * 100) / 100,
        price_after_markup: Math.round(priceAfterMarkup * 100) / 100,
        discount_amount: Math.round(discountAmount * 100) / 100,
        final_price: finalPrice,
        unit_price: finalPrice,
        line_total: lineTotal
    };
}

function calculateEstimateTotals(items) {
    let subtotal = 0, totalMarkup = 0, totalDiscount = 0, totalLabor = 0;

    for (const item of items) {
        if (item.item_type === 'labor') {
            totalLabor += parseFloat(item.line_total) || 0;
        } else {
            subtotal += parseFloat(item.line_total) || 0;
            totalMarkup += (parseFloat(item.markup_amount) || 0) * (parseFloat(item.quantity) || 1);
            totalDiscount += (parseFloat(item.discount_amount) || 0) * (parseFloat(item.quantity) || 1);
        }
    }

    return {
        subtotal: Math.round(subtotal * 100) / 100,
        total_markup: Math.round(totalMarkup * 100) / 100,
        total_discount: Math.round(totalDiscount * 100) / 100,
        total_labor: Math.round(totalLabor * 100) / 100,
        gst_amount: 0,
        grand_total: Math.round((subtotal + totalLabor) * 100) / 100
    };
}

// Helper to build item values array for INSERT
function buildItemValues(estimateId, items) {
    return items.map(item => [
        estimateId,
        item.item_type || 'product',
        item.product_id || null,
        item.zoho_item_id || null,
        item.item_name || item.item_description || null,
        item.brand || null,
        item.category || null,
        item.image_url || null,
        item.pack_size || null,
        item.product_type || null,
        item.custom_description || null,
        item.show_description_only != null ? (item.show_description_only ? 1 : 0) : null,
        item.item_description || item.item_name || null,
        item.quantity || 1,
        item.area || null,
        item.mix_info || null,
        item.num_coats || 1,
        item.base_price || item.unit_price || 0,
        item.markup_type || null,
        item.markup_value || 0,
        item.markup_amount || 0,
        item.price_after_markup || item.unit_price || 0,
        item.discount_type || null,
        item.discount_value || 0,
        item.discount_amount || 0,
        item.final_price || item.unit_price || 0,
        item.unit_price || 0,
        item.breakdown_cost || null,
        item.color_cost || 0,
        item.line_total || 0,
        item.display_order || 0,
        item.labor_description || null,
        item.labor_taxable != null ? (item.labor_taxable ? 1 : 0) : 1,
        item.hide_price ? 1 : 0
    ]);
}

const ITEM_INSERT_SQL = `INSERT INTO estimate_items (
    estimate_id, item_type, product_id, zoho_item_id, item_name,
    brand, category, image_url, pack_size, product_type,
    custom_description, show_description_only,
    item_description, quantity, area, mix_info, num_coats,
    base_price, markup_type, markup_value, markup_amount, price_after_markup,
    discount_type, discount_value, discount_amount, final_price,
    unit_price, breakdown_cost, color_cost, line_total, display_order,
    labor_description, labor_taxable, hide_price
) VALUES ?`;

// Process items through calculation engine
function processItems(items) {
    return (items || []).map(item => {
        if (item.item_type === 'labor') {
            return {
                ...item,
                base_price: parseFloat(item.base_price) || 0,
                unit_price: parseFloat(item.base_price) || 0,
                line_total: (parseFloat(item.base_price) || 0) * (parseFloat(item.quantity) || 1),
                final_price: parseFloat(item.base_price) || 0
            };
        }
        const calc = calculateItemPricing(item);
        return { ...item, ...calc };
    });
}

// ========================================
// LIST ESTIMATES
// ========================================
router.get('/', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const { status, search, branch_id } = req.query;
        let query = 'SELECT * FROM estimates WHERE 1=1';
        const params = [];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (branch_id) { query += ' AND branch_id = ?'; params.push(branch_id); }
        if (search) {
            query += ' AND (estimate_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY estimate_date DESC, id DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPI QR CODE GENERATION
// ========================================
router.get('/:id/upi-qr', requireAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            'SELECT id, estimate_number, grand_total FROM estimates WHERE id = ?',
            [req.params.id]
        );
        if (!estimates.length) return res.status(404).json({ error: 'Estimate not found' });

        const est = estimates[0];
        const amount = parseFloat(est.grand_total) || 0;
        const upiUrl = `upi://pay?pa=7418831122@superyes&pn=Quality Colours&am=${amount.toFixed(2)}&cu=INR&tn=EST-${est.estimate_number}`;

        const QRCode = require('qrcode');
        const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 200, margin: 1 });

        res.json({
            success: true,
            data: {
                qr_image: qrDataUrl,
                upi_url: upiUrl,
                amount: amount,
                estimate_number: est.estimate_number
            }
        });
    } catch (err) {
        console.error('UPI QR error:', err);
        res.status(500).json({ error: 'Failed to generate UPI QR' });
    }
});

// ========================================
// SEND ESTIMATE PDF VIA WHATSAPP
// ========================================
router.post('/:id/send-whatsapp', requireAuth, async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

        // Get estimate details
        const [estimates] = await pool.query(
            'SELECT id, estimate_number, customer_name, grand_total FROM estimates WHERE id = ?',
            [req.params.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];

        // Generate PDF by fetching from internal endpoint
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '';
        const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

        const pdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!pdfResp.ok) throw new Error('Failed to generate PDF');
        const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());

        // Save to temp file
        const tmpDir = path.join(os.tmpdir(), 'qc-estimates');
        fs.mkdirSync(tmpDir, { recursive: true });
        const pdfPath = path.join(tmpDir, `EST-${est.estimate_number}.pdf`);
        fs.writeFileSync(pdfPath, pdfBuffer);

        // Send PDF via WhatsApp
        const sessionManager = require('../services/whatsapp-session-manager');
        const ADMIN_BRANCH = -1;
        const GENERAL_ID = 0;

        // Build caption with UPI payment link — everything in ONE message with the PDF
        const amount = parseFloat(est.grand_total) || 0;
        const upiUrl = `upi://pay?pa=7418831122@superyes&pn=Quality%20Colours&am=${amount.toFixed(2)}&cu=INR&tn=EST-${est.estimate_number}`;
        const caption = `Dear ${est.customer_name || 'Customer'},\n\nEstimate *#${est.estimate_number}* from *Quality Colours*\n\n*Total: ₹${amount.toLocaleString('en-IN')}*\n\n💳 *Pay via UPI:*\n${upiUrl}\n\n_UPI ID: 7418831122@superyes_\n\nThank you!`;

        let sent = false;
        const mediaOpts = {
            type: 'document',
            mediaPath: pdfPath,
            caption: caption,
            filename: `Estimate-${est.estimate_number}.pdf`
        };
        try {
            sent = await sessionManager.sendMedia(ADMIN_BRANCH, phone, mediaOpts, { source: 'estimate', sent_by: req.user.id });
        } catch (e) {
            try {
                sent = await sessionManager.sendMedia(GENERAL_ID, phone, mediaOpts, { source: 'estimate', sent_by: req.user.id });
            } catch (e2) {
                console.error('WhatsApp send failed on both sessions:', e2.message);
            }
        }

        // Clean up temp file
        try { fs.unlinkSync(pdfPath); } catch (e) {}

        if (sent) {
            res.json({ success: true, message: 'Estimate PDF sent via WhatsApp' });
        } else {
            // Return wa.me fallback URL
            const crypto = require('crypto');
            const shareToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await pool.query(
                'INSERT INTO share_tokens (token, resource_type, resource_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)',
                [shareToken, 'estimate', req.params.id, req.user.id, expiresAt]
            );
            const shareUrl = `${req.protocol}://${req.get('host')}/share/estimate/${shareToken}`;
            const amount = parseFloat(est.grand_total) || 0;
            const msg = `Dear ${est.customer_name || 'Customer'},\n\nPlease find your estimate #${est.estimate_number} from Quality Colours:\n${shareUrl}\n\nTotal: ₹${amount.toLocaleString('en-IN')}\n\nThank you!`;

            let formattedPhone = phone.replace(/[^0-9]/g, '');
            if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
            const waUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`;

            res.json({ success: false, fallback: true, whatsapp_url: waUrl, message: 'WhatsApp session not available, use link instead' });
        }
    } catch (err) {
        console.error('Send WhatsApp estimate error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to send' });
    }
});

// ========================================
// RESEND PAYMENT RECEIPT VIA WHATSAPP
// ========================================
router.post('/:id/send-receipt', requireAuth, async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

        const [estimates] = await pool.query(
            'SELECT id, estimate_number, customer_name, grand_total, payment_amount, payment_method, payment_reference, payment_status FROM estimates WHERE id = ?',
            [req.params.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];

        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '';
        const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

        // Generate RECEIPT PDF (not estimate PDF)
        const pdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf?receipt=1`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!pdfResp.ok) return res.status(500).json({ success: false, message: 'Failed to generate receipt PDF' });

        const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
        const tmpDir = path.join(os.tmpdir(), 'qc-receipts');
        fs.mkdirSync(tmpDir, { recursive: true });
        const receiptPath = path.join(tmpDir, `Receipt-${est.estimate_number}.pdf`);
        fs.writeFileSync(receiptPath, pdfBuffer);

        const sessionManager = require('../services/whatsapp-session-manager');
        const grandTotal = parseFloat(est.grand_total) || 0;
        const paid = parseFloat(est.payment_amount) || 0;
        const balance = Math.max(0, grandTotal - paid);
        const caption = `Dear ${est.customer_name || 'Customer'},\n\n✅ *Payment Receipt*\n\nEstimate: *#${est.estimate_number}*\nTotal: *₹${grandTotal.toLocaleString('en-IN')}*\nPaid: *₹${paid.toLocaleString('en-IN')}*\nBalance: *₹${balance.toLocaleString('en-IN')}*${est.payment_method ? '\nMethod: ' + est.payment_method.toUpperCase() : ''}${est.payment_reference ? '\nRef: ' + est.payment_reference : ''}\n\nThank you!\n_Quality Colours_`;

        let sent = false;
        try {
            await sessionManager.sendMedia(-1, phone, { type: 'document', mediaPath: receiptPath, caption, filename: `Receipt-${est.estimate_number}.pdf` }, { source: 'payment-receipt', sent_by: req.user.id });
            sent = true;
        } catch (e) {
            try {
                await sessionManager.sendMedia(0, phone, { type: 'document', mediaPath: receiptPath, caption, filename: `Receipt-${est.estimate_number}.pdf` }, { source: 'payment-receipt', sent_by: req.user.id });
                sent = true;
            } catch (e2) { console.error('Receipt send fallback failed:', e2.message); }
        }
        try { fs.unlinkSync(receiptPath); } catch (e) {}

        if (sent) {
            res.json({ success: true, message: 'Receipt sent via WhatsApp' });
        } else {
            res.json({ success: false, message: 'WhatsApp session not available' });
        }
    } catch (err) {
        console.error('Send receipt error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to send receipt' });
    }
});

// ========================================
// UPDATE PAYMENT REFERENCE
// ========================================
router.post('/:id/update-payment-ref', requireAuth, async (req, res) => {
    try {
        const { payment_reference } = req.body;
        await pool.query('UPDATE estimates SET payment_reference = ? WHERE id = ?', [payment_reference || null, req.params.id]);
        // Also update the billing invoice payment if exists
        const [est] = await pool.query('SELECT billing_invoice_id FROM estimates WHERE id = ?', [req.params.id]);
        if (est[0] && est[0].billing_invoice_id) {
            await pool.query('UPDATE billing_payments SET payment_reference = ? WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
                [payment_reference || null, est[0].billing_invoice_id]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Update payment ref error:', err);
        res.status(500).json({ success: false, message: 'Failed to update reference' });
    }
});

// ========================================
// RECORD PAYMENT ON ESTIMATE
// ========================================
router.post('/:id/record-payment', requireAuth, async (req, res) => {
    try {
        const { amount, payment_method, payment_reference, send_whatsapp, phone } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Valid amount required' });
        if (!payment_method) return res.status(400).json({ success: false, message: 'Payment method required' });

        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];
        const grandTotal = parseFloat(est.grand_total) || 0;
        const prevPaid = parseFloat(est.payment_amount) || 0;
        const balance = Math.max(0, grandTotal - prevPaid);

        // Prevent overpayment
        if (parseFloat(amount) > balance + 0.01) {
            return res.status(400).json({ success: false, message: `Amount ₹${amount} exceeds balance ₹${balance.toFixed(2)}` });
        }
        if (balance <= 0.01) {
            return res.status(400).json({ success: false, message: 'Estimate is already fully paid' });
        }

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
            const [items] = await pool.query('SELECT * FROM estimate_items WHERE estimate_id = ?', [req.params.id]);
            const [[{ cnt }]] = await pool.query("SELECT COUNT(*) as cnt FROM billing_invoices WHERE DATE(created_at) = CURDATE()");
            const invoiceNumber = `BI-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Number(cnt) + 1).padStart(3,'0')}`;

            const [invResult] = await pool.query(`
                INSERT INTO billing_invoices (invoice_number, source, customer_name, customer_phone, customer_address,
                    subtotal, discount_amount, grand_total, amount_paid, balance_due, payment_status, estimate_id, branch_id, created_by)
                VALUES (?, 'estimate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [invoiceNumber, est.customer_name, est.customer_phone, est.customer_address,
                parseFloat(est.subtotal) || grandTotal, parseFloat(est.total_discount) || 0, grandTotal,
                newTotalPaid, balanceDue, paymentStatus, req.params.id, est.branch_id || 1, req.user.id]);
            invoiceId = invResult.insertId;

            for (const item of items) {
                if (item.item_type === 'labor') continue;
                await pool.query(`
                    INSERT INTO billing_invoice_items (invoice_id, item_name, quantity, unit_price, line_total)
                    VALUES (?, ?, ?, ?, ?)
                `, [invoiceId, item.item_name, item.quantity, item.unit_price || item.final_price, item.line_total]);
            }

            await pool.query('UPDATE estimates SET billing_invoice_id = ?, status = ? WHERE id = ?',
                [invoiceId, 'converted', req.params.id]);
        } else {
            await pool.query('UPDATE billing_invoices SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?',
                [newTotalPaid, balanceDue, paymentStatus, invoiceId]);
        }

        // Record in billing_payments
        await pool.query(`
            INSERT INTO billing_payments (invoice_id, amount, payment_method, payment_reference, received_by, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [invoiceId, amount, payment_method, payment_reference || null, req.user.id,
            `Payment for Estimate #${est.estimate_number}`]);

        // Send receipt via WhatsApp
        let whatsappSent = false;
        if (send_whatsapp && phone) {
            try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '';
                const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

                // Try receipt PDF first, fallback to estimate PDF
                let pdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf?receipt=1`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!pdfResp.ok) {
                    pdfResp = await fetch(`${baseUrl}/api/estimates/${req.params.id}/pdf`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }

                if (pdfResp.ok) {
                    const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
                    const tmpDir = path.join(os.tmpdir(), 'qc-receipts');
                    fs.mkdirSync(tmpDir, { recursive: true });
                    const receiptPath = path.join(tmpDir, `Receipt-${est.estimate_number}.pdf`);
                    fs.writeFileSync(receiptPath, pdfBuffer);

                    const sessionManager = require('../services/whatsapp-session-manager');
                    const paidAmt = parseFloat(amount).toLocaleString('en-IN');
                    const caption = `Dear ${est.customer_name || 'Customer'},\n\n✅ *Payment Received!*\n\nEstimate: *#${est.estimate_number}*\nAmount Paid: *₹${paidAmt}*\nTotal: *₹${grandTotal.toLocaleString('en-IN')}*\nBalance: *₹${balanceDue.toLocaleString('en-IN')}*\nMethod: ${payment_method.toUpperCase()}${payment_reference ? '\nRef: ' + payment_reference : ''}\n\nThank you!\n_Quality Colours_`;

                    try {
                        await sessionManager.sendMedia(-1, phone, { type: 'document', mediaPath: receiptPath, caption, filename: `Receipt-${est.estimate_number}.pdf` }, { source: 'payment-receipt', sent_by: req.user.id });
                        whatsappSent = true;
                    } catch (e) {
                        try {
                            await sessionManager.sendMedia(0, phone, { type: 'document', mediaPath: receiptPath, caption, filename: `Receipt-${est.estimate_number}.pdf` }, { source: 'payment-receipt', sent_by: req.user.id });
                            whatsappSent = true;
                        } catch (e2) { console.error('WhatsApp receipt fallback failed:', e2.message); }
                    }
                    try { fs.unlinkSync(receiptPath); } catch (e) {}
                }
            } catch (waErr) { console.error('WhatsApp receipt error:', waErr.message); }
        }

        res.json({ success: true, data: { payment_status: paymentStatus, amount_paid: newTotalPaid, balance_due: balanceDue, invoice_id: invoiceId, whatsapp_sent: whatsappSent } });
    } catch (err) {
        console.error('Record payment error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to record payment' });
    }
});

// ========================================
// CREATE PURCHASE ORDER FROM ESTIMATE
// ========================================
router.post('/:id/create-po', requireAuth, async (req, res) => {
    try {
        const { vendor_id, send_whatsapp, vendor_phone, notes, show_prices } = req.body;
        if (!vendor_id) return res.status(400).json({ success: false, message: 'Vendor is required' });

        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];

        const [items] = await pool.query("SELECT * FROM estimate_items WHERE estimate_id = ? AND item_type = 'product'", [req.params.id]);
        if (!items.length) return res.status(400).json({ success: false, message: 'No product items in estimate' });

        const [[{ cnt }]] = await pool.query("SELECT COUNT(*) as cnt FROM vendor_purchase_orders WHERE DATE(created_at) = CURDATE()");
        const poNumber = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Number(cnt) + 1).padStart(3,'0')}`;

        const subtotal = items.reduce((sum, it) => sum + ((parseFloat(it.base_price) || parseFloat(it.unit_price) || 0) * (parseFloat(it.quantity) || 1)), 0);

        const [poResult] = await pool.query(`
            INSERT INTO vendor_purchase_orders
                (po_number, vendor_id, estimate_id, subtotal, tax_amount, grand_total,
                 delivery_name, delivery_phone, delivery_address, is_third_party,
                 expected_date, notes, status, created_by)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, true, DATE_ADD(NOW(), INTERVAL 3 DAY), ?, 'draft', ?)
        `, [poNumber, vendor_id, req.params.id, subtotal, subtotal,
            est.customer_name, est.customer_phone, est.customer_address,
            notes || `PO from Estimate #${est.estimate_number}`, req.user.id]);
        const poId = poResult.insertId;

        for (const item of items) {
            const unitPrice = parseFloat(item.base_price) || parseFloat(item.unit_price) || 0;
            await pool.query(`
                INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [poId, item.zoho_item_id, item.item_name, parseFloat(item.quantity) || 1, unitPrice, unitPrice * (parseFloat(item.quantity) || 1)]);
        }

        let whatsappSent = false;
        if (send_whatsapp && vendor_phone) {
            try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const sessionManager = require('../services/whatsapp-session-manager');

                // Generate PO PDF as simple HTML → Puppeteer
                const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '';
                const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
                const pdfUrl = `${baseUrl}/api/estimates/${req.params.id}/pdf?po=${poId}&hide_payment=1${!show_prices ? '&hide_prices=1' : ''}`;
                console.log('[PO PDF] URL:', pdfUrl, '| show_prices:', show_prices);
                const pdfResp = await fetch(pdfUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const caption = `*Purchase Order #${poNumber}*\nFrom: *Quality Colours*\n\n📦 *3rd Party Delivery:*\n${est.customer_name}\n${est.customer_phone}\n${est.customer_address || 'Address TBC'}\n\nPlease confirm and deliver.\nThank you!`;

                if (pdfResp.ok) {
                    // Send as PDF document
                    const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
                    const tmpDir = path.join(os.tmpdir(), 'qc-po');
                    fs.mkdirSync(tmpDir, { recursive: true });
                    const poPath = path.join(tmpDir, `PO-${poNumber}.pdf`);
                    fs.writeFileSync(poPath, pdfBuffer);

                    try {
                        await sessionManager.sendMedia(-1, vendor_phone, { type: 'document', mediaPath: poPath, caption, filename: `PO-${poNumber}.pdf` }, { source: 'purchase-order', sent_by: req.user.id });
                        whatsappSent = true;
                    } catch (e) {
                        try {
                            await sessionManager.sendMedia(0, vendor_phone, { type: 'document', mediaPath: poPath, caption, filename: `PO-${poNumber}.pdf` }, { source: 'purchase-order', sent_by: req.user.id });
                            whatsappSent = true;
                        } catch (e2) { console.error('WhatsApp PO fallback failed:', e2.message); }
                    }
                    try { fs.unlinkSync(poPath); } catch (e) {}
                } else {
                    // Fallback: send as text message if PDF fails
                    try {
                        await sessionManager.sendMessage(-1, vendor_phone, caption, { source: 'purchase-order', sent_by: req.user.id });
                        whatsappSent = true;
                    } catch (e) {
                        await sessionManager.sendMessage(0, vendor_phone, caption, { source: 'purchase-order', sent_by: req.user.id }).catch(() => {});
                        whatsappSent = true;
                    }
                }
                await pool.query("UPDATE vendor_purchase_orders SET status = 'sent' WHERE id = ?", [poId]);
            } catch (waErr) { console.error('WhatsApp PO error:', waErr.message); }
        }

        res.json({ success: true, data: { po_id: poId, po_number: poNumber, grand_total: subtotal, whatsapp_sent: whatsappSent } });
    } catch (err) {
        console.error('Create PO error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to create PO' });
    }
});

// ========================================
// GET PURCHASE ORDERS FOR ESTIMATE
// ========================================
router.get('/:id/purchase-orders', requireAuth, async (req, res) => {
    try {
        const [pos] = await pool.query(
            `SELECT po.*, v.vendor_name, v.phone as vendor_phone
             FROM vendor_purchase_orders po
             LEFT JOIN vendors v ON po.vendor_id = v.id
             WHERE po.estimate_id = ? ORDER BY po.created_at DESC`,
            [req.params.id]
        );
        res.json({ success: true, data: pos });
    } catch (err) {
        console.error('Get estimate POs error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch POs' });
    }
});

// ========================================
// GET SINGLE ESTIMATE
// ========================================
router.get('/:id', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (estimate.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }

        const [items] = await pool.query(`
            SELECT ei.*, p.name as product_name, p.product_type as product_type
            FROM estimate_items ei
            LEFT JOIN products p ON ei.product_id = p.id
            WHERE ei.estimate_id = ?
            ORDER BY ei.display_order, ei.id
        `, [req.params.id]);

        res.json({ ...estimate[0], items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// GET ESTIMATE ITEMS
// ========================================
router.get('/:id/items', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [items] = await pool.query(
            'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY display_order',
            [req.params.id]
        );
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CREATE ESTIMATE
// ========================================
router.post('/', requirePermission('estimates', 'add'), async (req, res) => {
    try {
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            show_gst_breakdown, column_visibility, show_description_only,
            notes, admin_notes, status, branch_id, items
        } = req.body;

        // Generate estimate number
        const datePrefix = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const [lastEstimate] = await pool.query(
            'SELECT estimate_number FROM estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
            [`EST${datePrefix}%`]
        );

        let estimateNumber;
        if (lastEstimate.length > 0) {
            const lastNum = parseInt(lastEstimate[0].estimate_number.slice(-4));
            estimateNumber = `EST${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
        } else {
            estimateNumber = `EST${datePrefix}0001`;
        }

        // Calculate item pricing
        const processedItems = processItems(items);
        const totals = calculateEstimateTotals(processedItems);

        // Insert estimate
        const [result] = await pool.query(
            `INSERT INTO estimates (
                estimate_number, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, branch_id,
                subtotal, gst_amount, grand_total,
                total_markup, total_discount, total_labor,
                show_gst_breakdown, column_visibility, show_description_only,
                notes, admin_notes, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                estimateNumber, customer_name, customer_phone, customer_address,
                estimate_date, valid_until || null, branch_id || null,
                totals.subtotal, totals.gst_amount, totals.grand_total,
                totals.total_markup, totals.total_discount, totals.total_labor,
                show_gst_breakdown ? 1 : 0, column_visibility || null, show_description_only ? 1 : 0,
                notes || null, admin_notes || null, status || 'draft',
                req.user ? req.user.id : 1
            ]
        );

        const estimateId = result.insertId;

        // Insert items
        if (processedItems.length > 0) {
            await pool.query(ITEM_INSERT_SQL, [buildItemValues(estimateId, processedItems)]);
        }

        res.json({ success: true, id: estimateId, estimate_number: estimateNumber, message: 'Estimate created successfully' });
    } catch (err) {
        console.error('Create estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPDATE ESTIMATE
// ========================================
router.put('/:id', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            show_gst_breakdown, column_visibility, show_description_only,
            notes, admin_notes, branch_id, items
        } = req.body;

        // Calculate item pricing
        const processedItems = processItems(items);
        const totals = calculateEstimateTotals(processedItems);

        await pool.query(
            `UPDATE estimates SET
                customer_name = ?, customer_phone = ?, customer_address = ?,
                estimate_date = ?, valid_until = ?, branch_id = ?,
                subtotal = ?, gst_amount = ?, grand_total = ?,
                total_markup = ?, total_discount = ?, total_labor = ?,
                show_gst_breakdown = ?, column_visibility = ?, show_description_only = ?,
                notes = ?, admin_notes = ?,
                last_updated_at = NOW()
            WHERE id = ?`,
            [
                customer_name, customer_phone, customer_address || null,
                estimate_date, valid_until || null, branch_id || null,
                totals.subtotal, totals.gst_amount, totals.grand_total,
                totals.total_markup, totals.total_discount, totals.total_labor,
                show_gst_breakdown ? 1 : 0, column_visibility || null, show_description_only ? 1 : 0,
                notes || null, admin_notes || null, estimateId
            ]
        );

        // Replace items
        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);

        if (processedItems.length > 0) {
            await pool.query(ITEM_INSERT_SQL, [buildItemValues(estimateId, processedItems)]);
        }

        res.json({ success: true, message: 'Estimate updated successfully' });
    } catch (err) {
        console.error('Update estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// DELETE ESTIMATE (preserves existing behavior — no status guard)
// ========================================
router.delete('/:id', requirePermission('estimates', 'delete'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [estimateId]);
        if (estimate.length === 0) return res.status(404).json({ error: 'Estimate not found' });

        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);
        await pool.query('DELETE FROM estimates WHERE id = ?', [estimateId]);
        res.json({ success: true, message: 'Estimate deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPDATE STATUS (PATCH — preserves existing method + history logging)
// ========================================
router.patch('/:id/status', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const { status, reason, notes } = req.body;
        const estimateId = req.params.id;

        const [current] = await pool.query('SELECT status FROM estimates WHERE id = ?', [estimateId]);
        if (current.length === 0) return res.status(404).json({ error: 'Estimate not found' });

        const oldStatus = current[0].status;

        const setClauses = ['status = ?', 'last_updated_at = NOW()'];
        const params = [status];

        if (status === 'approved') {
            setClauses.push('approved_by_admin_id = ?', 'approved_at = NOW()');
            params.push(req.user.id);
        }

        params.push(estimateId);
        await pool.query(`UPDATE estimates SET ${setClauses.join(', ')} WHERE id = ?`, params);

        await pool.query(
            'INSERT INTO estimate_status_history (estimate_id, old_status, new_status, changed_by_user_id, reason, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [estimateId, oldStatus, status, req.user.id, reason, notes]
        );

        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// ESTIMATE HISTORY (uses estimate_status_history table)
// ========================================
router.get('/:id/history', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [history] = await pool.query(`
            SELECT h.*, u.full_name as changed_by_name
            FROM estimate_status_history h
            LEFT JOIN users u ON h.changed_by_user_id = u.id
            WHERE h.estimate_id = ?
            ORDER BY h.timestamp DESC
        `, [req.params.id]);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, setPool };
