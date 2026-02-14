const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Helper: format currency Indian style
function formatINR(num) {
    const n = parseFloat(num) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate estimate PDF and pipe to response
 * @param {Response} res - Express response
 * @param {Object} estimate - Estimate record
 * @param {Array} items - Estimate items
 * @param {Object} branding - Branding settings
 * @param {Object} colVis - Column visibility settings
 */
function generateEstimatePDF(res, estimate, items, branding, colVis) {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    const filename = `${estimate.estimate_number || 'Estimate'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Colors
    const purple = '#667eea';
    const darkGray = '#333333';
    const medGray = '#666666';
    const lightGray = '#f3f4f6';
    const orange = '#ea580c';

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
    doc.fontSize(18).fillColor(purple).font('Helvetica-Bold')
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
    doc.fontSize(24).fillColor(orange).font('Helvetica-Bold')
        .text('ESTIMATE', 350, headerTop, { width: 205, align: 'right' });

    // Estimate meta
    const estDate = estimate.estimate_date
        ? new Date(estimate.estimate_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';
    doc.fontSize(9).fillColor(darkGray).font('Helvetica')
        .text(`Date: ${estDate}`, 350, headerTop + 30, { width: 205, align: 'right' })
        .text(`Ref #: ${estimate.estimate_number}`, 350, headerTop + 42, { width: 205, align: 'right' })
        .text(`Status: ${(estimate.status || 'draft').toUpperCase()}`, 350, headerTop + 54, { width: 205, align: 'right' });

    // Purple divider line
    doc.moveTo(40, headerTop + 70).lineTo(555, headerTop + 70).strokeColor(purple).lineWidth(2).stroke();

    // ===== BILL TO =====
    doc.y = headerTop + 82;
    doc.fontSize(9).fillColor(medGray).font('Helvetica-Bold').text('BILL TO:', 40, doc.y);
    doc.fontSize(12).fillColor(darkGray).font('Helvetica-Bold')
        .text(estimate.customer_name || '', 40, doc.y + 2);
    doc.fontSize(9).fillColor(medGray).font('Helvetica');
    if (estimate.customer_phone) doc.text(estimate.customer_phone);
    if (estimate.customer_address) doc.text(estimate.customer_address);

    doc.moveDown(1);

    // ===== ITEMS TABLE =====
    const cols = [];
    cols.push({ key: '#', width: 25, align: 'left', label: '#' });
    cols.push({ key: 'desc', width: 130, align: 'left', label: 'ITEM DETAILS' });
    if (colVis.show_qty) cols.push({ key: 'qty', width: 60, align: 'left', label: 'QTY/AREA' });
    if (colVis.show_mix) cols.push({ key: 'mix', width: 65, align: 'left', label: 'MIX INFO' });
    if (colVis.show_price) cols.push({ key: 'price', width: 55, align: 'right', label: 'PRICE' });
    if (colVis.show_breakdown) cols.push({ key: 'breakdown', width: 60, align: 'left', label: 'BREAKDOWN' });
    if (colVis.show_color) cols.push({ key: 'color', width: 50, align: 'right', label: 'COLOR' });
    if (colVis.show_total) cols.push({ key: 'total', width: 65, align: 'right', label: 'TOTAL' });

    // Distribute remaining width to description
    const totalWidth = 515;
    const usedWidth = cols.reduce((sum, c) => sum + c.width, 0);
    if (usedWidth < totalWidth) {
        const descCol = cols.find(c => c.key === 'desc');
        if (descCol) descCol.width += totalWidth - usedWidth;
    }

    const tableTop = doc.y;
    const rowHeight = 22;
    const headerHeight = 24;
    let x = 40;

    // Table header background
    doc.rect(40, tableTop, totalWidth, headerHeight).fill('#1f2937');

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

        cols.forEach(col => {
            let val = '';
            switch (col.key) {
                case '#': val = String(idx + 1); break;
                case 'desc': val = item.item_description || item.product_name || ''; break;
                case 'qty': val = `${item.quantity}${item.area ? ` (${item.area} sqft)` : ''}`; break;
                case 'mix': val = item.mix_info || '-'; break;
                case 'price': val = `₹${formatINR(item.unit_price)}`; break;
                case 'breakdown': val = item.breakdown_cost || '-'; break;
                case 'color': val = `₹${formatINR(item.color_cost || 0)}`; break;
                case 'total': val = `₹${formatINR(item.line_total)}`; break;
            }
            const textX = col.align === 'right' ? x : x + 4;
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

    if (estimate.show_gst_breakdown) {
        doc.fontSize(9).fillColor(darkGray).font('Helvetica');
        doc.text('Subtotal (excl. GST):', summaryX, y, { width: 120 });
        doc.text(`₹${formatINR(estimate.subtotal)}`, summaryX + 120, y, { width: summaryW - 120, align: 'right' });
        y += 16;

        doc.text('GST @18%:', summaryX, y, { width: 120 });
        doc.text(`₹${formatINR(estimate.gst_amount)}`, summaryX + 120, y, { width: summaryW - 120, align: 'right' });
        y += 16;

        doc.moveTo(summaryX, y).lineTo(summaryX + summaryW, y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
        y += 5;
    }

    // Grand total
    doc.fontSize(13).fillColor(purple).font('Helvetica-Bold');
    doc.text('Grand Total:', summaryX, y, { width: 100 });
    doc.text(`₹${formatINR(estimate.grand_total)}`, summaryX + 100, y, { width: summaryW - 100, align: 'right' });
    y += 20;

    // Amount in words
    const totalWords = Math.floor(parseFloat(estimate.grand_total) || 0).toLocaleString('en-IN');
    doc.fontSize(7.5).fillColor(medGray).font('Helvetica')
        .text(`Amount in Words: Rupees ${totalWords} Only`, summaryX, y, { width: summaryW });

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
    doc.fontSize(7).fillColor('#999999').font('Helvetica')
        .text('Generated by Quality Colours Business Manager', 40, footerY, { width: 515, align: 'center' });

    doc.end();
}

module.exports = { generateEstimatePDF };
