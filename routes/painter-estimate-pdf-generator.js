const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Helper: format currency Indian style
function formatINR(num) {
    const n = parseFloat(num) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate painter estimate PDF and pipe to response
 * @param {Response} res - Express response
 * @param {Object} estimate - Estimate record (with painter_name, customer_name, etc.)
 * @param {Array} items - Estimate items
 * @param {Object} branding - Branding settings (business_logo, business_name, etc.)
 * @param {Object} options - { showMarkup: boolean } — true for customer billing customer-facing view
 */
function generatePainterEstimatePDF(res, estimate, items, branding, options = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    const filename = `${estimate.estimate_number || 'Estimate'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Painter brand colors
    const green = '#1B5E3B';
    const gold = '#D4A24E';
    const darkGray = '#333333';
    const medGray = '#666666';
    const lightGray = '#f3f4f6';

    const showMarkup = options.showMarkup && estimate.billing_type === 'customer';

    // ===== HEADER =====
    const headerTop = doc.y;

    // Try to load company logo
    const logoPaths = [
        branding.business_logo ? path.join(__dirname, '..', 'public', 'uploads', 'logos', branding.business_logo) : null,
        path.join(__dirname, '..', 'public', 'logo.png')
    ].filter(Boolean);

    let logoLoaded = false;
    for (const logoPath of logoPaths) {
        if (fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, 40, headerTop, { height: 50 });
                logoLoaded = true;
                break;
            } catch {}
        }
    }

    const textStartX = logoLoaded ? 100 : 40;

    // Company Name
    doc.fontSize(18).fillColor(green).font('Helvetica-Bold')
        .text(branding.business_name || 'Quality Colours', textStartX, headerTop);

    // Company details
    doc.fontSize(8).fillColor(medGray).font('Helvetica');
    const compAddr = branding.business_address || 'Ramanathapuram';
    const compPhone = branding.business_phone || '+91 7418831122';
    const compEmail = branding.business_email || 'info@qcpaintshop.com';
    const compGst = branding.business_gst || '33EMXPS2411G1ZT';
    doc.text(compAddr, textStartX, headerTop + 24);
    doc.text(`Phone: ${compPhone} | Email: ${compEmail}`, textStartX, headerTop + 35);
    doc.text(`GST: ${compGst}`, textStartX, headerTop + 46);

    // Estimate title - right side
    doc.fontSize(24).fillColor(gold).font('Helvetica-Bold')
        .text('ESTIMATE', 350, headerTop, { width: 205, align: 'right' });

    // Estimate meta
    const estDate = estimate.estimate_date || estimate.created_at
        ? new Date(estimate.estimate_date || estimate.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';
    doc.fontSize(9).fillColor(darkGray).font('Helvetica')
        .text(`Date: ${estDate}`, 350, headerTop + 30, { width: 205, align: 'right' })
        .text(`Ref #: ${estimate.estimate_number}`, 350, headerTop + 42, { width: 205, align: 'right' })
        .text(`Status: ${(estimate.status || 'draft').replace(/_/g, ' ').toUpperCase()}`, 350, headerTop + 54, { width: 205, align: 'right' });

    // Green divider line
    doc.moveTo(40, headerTop + 70).lineTo(555, headerTop + 70).strokeColor(green).lineWidth(2).stroke();

    // ===== BILL TO / PAINTER =====
    doc.y = headerTop + 82;

    // Left side: Bill To (customer) or Painter info
    if (estimate.billing_type === 'customer' && estimate.customer_name) {
        doc.fontSize(9).fillColor(medGray).font('Helvetica-Bold').text('BILL TO:', 40, doc.y);
        doc.fontSize(12).fillColor(darkGray).font('Helvetica-Bold')
            .text(estimate.customer_name, 40, doc.y + 2);
        doc.fontSize(9).fillColor(medGray).font('Helvetica');
        if (estimate.customer_phone) doc.text(estimate.customer_phone);
        if (estimate.customer_address) doc.text(estimate.customer_address);
    } else {
        doc.fontSize(9).fillColor(medGray).font('Helvetica-Bold').text('PAINTER:', 40, doc.y);
        doc.fontSize(12).fillColor(darkGray).font('Helvetica-Bold')
            .text(estimate.painter_name || '', 40, doc.y + 2);
        doc.fontSize(9).fillColor(medGray).font('Helvetica');
        if (estimate.painter_phone) doc.text(estimate.painter_phone);
    }

    doc.moveDown(1);

    // ===== ITEMS TABLE =====
    const cols = [
        { key: '#', width: 30, align: 'center', label: '#' },
        { key: 'product', width: 200, align: 'left', label: 'PRODUCT' },
        { key: 'brand', width: 80, align: 'left', label: 'BRAND' },
        { key: 'qty', width: 50, align: 'center', label: 'QTY' },
        { key: 'rate', width: 70, align: 'right', label: 'RATE' },
        { key: 'amount', width: 85, align: 'right', label: 'AMOUNT' }
    ];

    const totalWidth = 515;

    const tableTop = doc.y;
    const rowHeight = 22;
    const headerHeight = 24;
    let x = 40;

    // Table header background — dark green
    doc.rect(40, tableTop, totalWidth, headerHeight).fill('#0d2818');

    // Header text
    x = 40;
    doc.fontSize(7.5).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach(col => {
        const textX = col.align === 'right' ? x : x + 4;
        doc.text(col.label, textX, tableTop + 7, { width: col.width - 8, align: col.align });
        x += col.width;
    });

    // Table rows
    let y = tableTop + headerHeight;
    items.forEach((item, idx) => {
        if (y + rowHeight > doc.page.height - 120) {
            doc.addPage();
            y = 40;
        }

        if (idx % 2 === 0) {
            doc.rect(40, y, totalWidth, rowHeight).fill(lightGray);
        }

        x = 40;
        doc.fontSize(8).fillColor(darkGray).font('Helvetica');

        const unitPrice = showMarkup
            ? (parseFloat(item.markup_unit_price) || parseFloat(item.unit_price))
            : parseFloat(item.unit_price);
        const lineTotal = showMarkup
            ? (parseFloat(item.markup_line_total) || parseFloat(item.line_total))
            : parseFloat(item.line_total);

        cols.forEach(col => {
            let val = '';
            switch (col.key) {
                case '#': val = String(idx + 1); break;
                case 'product': val = item.item_name || ''; break;
                case 'brand': val = item.brand || '-'; break;
                case 'qty': val = String(parseFloat(item.quantity)); break;
                case 'rate': val = `₹${formatINR(unitPrice)}`; break;
                case 'amount': val = `₹${formatINR(lineTotal)}`; break;
            }
            const textX = col.align === 'right' ? x : (col.align === 'center' ? x : x + 4);
            doc.text(val, textX, y + 6, { width: col.width - 8, align: col.align, lineBreak: false });
            x += col.width;
        });

        y += rowHeight;
    });

    // Bottom border
    doc.moveTo(40, y).lineTo(40 + totalWidth, y).strokeColor('#d1d5db').lineWidth(0.5).stroke();

    // ===== SUMMARY =====
    y += 15;
    if (y > doc.page.height - 100) { doc.addPage(); y = 40; }

    const summaryX = 350;
    const summaryW = 205;

    // Subtotal
    const subtotal = showMarkup
        ? (parseFloat(estimate.markup_subtotal) || parseFloat(estimate.subtotal))
        : parseFloat(estimate.subtotal);

    doc.fontSize(9).fillColor(darkGray).font('Helvetica');
    doc.text('Subtotal:', summaryX, y, { width: 120 });
    doc.text(`₹${formatINR(subtotal)}`, summaryX + 120, y, { width: summaryW - 120, align: 'right' });
    y += 16;

    // Discount line (if applicable)
    const discountPct = parseFloat(estimate.discount_percentage) || 0;
    const discountAmt = parseFloat(estimate.discount_amount) || 0;
    if (discountPct > 0 && discountAmt > 0) {
        doc.fillColor('#dc2626');
        doc.text(`Discount (${discountPct}%):`, summaryX, y, { width: 120 });
        doc.text(`-₹${formatINR(discountAmt)}`, summaryX + 120, y, { width: summaryW - 120, align: 'right' });
        y += 16;
    }

    doc.moveTo(summaryX, y).lineTo(summaryX + summaryW, y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    y += 5;

    // Grand total
    let grandTotal;
    if (discountAmt > 0 && estimate.final_grand_total) {
        grandTotal = parseFloat(estimate.final_grand_total);
    } else if (showMarkup) {
        grandTotal = parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total);
    } else {
        grandTotal = parseFloat(estimate.grand_total);
    }

    doc.fontSize(13).fillColor(green).font('Helvetica-Bold');
    doc.text('Grand Total:', summaryX, y, { width: 100 });
    doc.text(`₹${formatINR(grandTotal)}`, summaryX + 100, y, { width: summaryW - 100, align: 'right' });
    y += 20;

    // GST note
    doc.fontSize(7.5).fillColor(medGray).font('Helvetica')
        .text('* Prices inclusive of GST', summaryX, y, { width: summaryW, align: 'right' });

    // ===== NOTES =====
    if (estimate.notes && estimate.notes.trim()) {
        y += 25;
        if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 10;
        doc.fontSize(9).fillColor(darkGray).font('Helvetica-Bold').text('Notes:', 40, y);
        y += 14;
        doc.fontSize(8).fillColor(medGray).font('Helvetica').text(estimate.notes, 40, y, { width: 515 });
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.fontSize(7).fillColor(gold).font('Helvetica-Bold')
        .text('Quality Colours — Your Trusted Paint Partner', 40, footerY, { width: 515, align: 'center' });

    doc.end();
}

module.exports = { generatePainterEstimatePDF };
