const PDFDocument = require('pdfkit');
const path = require('path');

const BRAND_GREEN    = '#1B5E3B';
const COMPANY_NAME   = 'Quality Colours';
const COMPANY_DETAIL = 'Quality Colours, Chennai  |  +91 74188 31122';

const FONT_REGULAR = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const FONT_BOLD    = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');

function computeFinalPrice(dpl, markupPercent) {
    const d = parseFloat(dpl);
    const m = parseFloat(markupPercent);
    if (!isFinite(d) || !isFinite(m)) return 0;
    return Math.ceil(d * (1 + m / 100) * 1.18);
}

function groupRowsForPdf(rows, brandLabel) {
    const items = rows.map(row => ({
        productName: row.product || '',
        category:    (row.category || 'Other').trim(),
        colourName:  row.colourName || '',
        packSize:    row.packSize || '',
        finalPrice:  row.finalPrice || 0,
    }));
    items.sort((a, b) => {
        const c = a.category.localeCompare(b.category, 'en');
        if (c !== 0) return c;
        const n = a.productName.localeCompare(b.productName, 'en');
        return n !== 0 ? n : a.packSize.localeCompare(b.packSize, 'en', { numeric: true });
    });
    return { brandLabel, items };
}

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatINR(num) {
    return '₹ ' + Math.round(parseFloat(num) || 0).toLocaleString('en-IN');
}

function generatePriceListPdf(brandGroups, { customerName, markupPercent, effectiveDate }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

        doc.registerFont('Regular', FONT_REGULAR);
        doc.registerFont('Bold',    FONT_BOLD);

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const MARGIN         = 40;
        const PAGE_W         = doc.page.width - 2 * MARGIN;
        const PAGE_H         = doc.page.height;
        const FOOTER_RESERVE = 45;
        const ROW_H          = 18;

        const COL_PRODUCT  = 206;
        const COL_CATEGORY =  77;
        const COL_COLOUR   =  88;
        const COL_SIZE     =  62;
        const COL_PRICE    =  77;

        const markupSign  = markupPercent >= 0 ? '+' : '';
        const displayDate = formatDisplayDate(effectiveDate || new Date().toISOString().slice(0, 10));

        function drawPageHeader() {
            const y = MARGIN;
            doc.fontSize(18).fillColor(BRAND_GREEN).font('Bold')
               .text(COMPANY_NAME, MARGIN, y, { lineBreak: false });
            doc.fontSize(9).fillColor('#6b7280').font('Regular')
               .text('Price List', MARGIN, y + 24, { lineBreak: false });
            doc.fontSize(7.5).fillColor('#9ca3af').font('Regular')
               .text(COMPANY_DETAIL, MARGIN, y + 6, { width: PAGE_W, align: 'right', lineBreak: false });
            doc.moveTo(MARGIN, y + 38).lineTo(MARGIN + PAGE_W, y + 38)
               .strokeColor('#d1d5db').lineWidth(0.5).stroke();
            return y + 50;
        }

        function drawTableHeader(y) {
            doc.rect(MARGIN, y, PAGE_W, 16).fill('#1f2937');
            doc.fontSize(7.5).fillColor('#ffffff').font('Bold');
            let x = MARGIN + 4;
            doc.text('PRODUCT',  x,     y + 4, { width: COL_PRODUCT  - 8, lineBreak: false }); x += COL_PRODUCT;
            doc.text('CATEGORY', x + 4, y + 4, { width: COL_CATEGORY - 8, lineBreak: false }); x += COL_CATEGORY;
            doc.text('COLOUR',   x + 4, y + 4, { width: COL_COLOUR   - 8, lineBreak: false }); x += COL_COLOUR;
            doc.text('SIZE',     x + 4, y + 4, { width: COL_SIZE     - 8, lineBreak: false }); x += COL_SIZE;
            doc.text('PRICE',    x,     y + 4, { width: COL_PRICE    - 4, align: 'right', lineBreak: false });
            return y + 16;
        }

        let y = drawPageHeader();

        doc.fontSize(11).fillColor('#1f2937').font('Bold')
           .text('Prepared for: ' + customerName, MARGIN, y + 10, { lineBreak: false });
        doc.fontSize(8.5).fillColor('#6b7280').font('Regular')
           .text('Date: ' + displayDate + '     Markup: ' + markupSign + markupPercent + '%     Prices inclusive of 18% GST',
                 MARGIN, y + 26, { lineBreak: false });
        doc.moveTo(MARGIN, y + 42).lineTo(MARGIN + PAGE_W, y + 42)
           .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 52;

        for (const group of brandGroups) {
            if (y > PAGE_H - FOOTER_RESERVE - 100) {
                doc.addPage();
                y = drawPageHeader();
            }

            doc.rect(MARGIN, y, PAGE_W, 22).fill('#f0fdf4');
            doc.moveTo(MARGIN, y).lineTo(MARGIN + PAGE_W, y).strokeColor('#a7f3d0').lineWidth(1).stroke();
            doc.fontSize(12).fillColor(BRAND_GREEN).font('Bold')
               .text(group.brandLabel.toUpperCase(), MARGIN + 8, y + 5, { width: PAGE_W - 16, lineBreak: false });
            doc.moveTo(MARGIN, y + 22).lineTo(MARGIN + PAGE_W, y + 22).strokeColor('#a7f3d0').lineWidth(0.5).stroke();
            y += 26;

            if (y > PAGE_H - FOOTER_RESERVE - 40) {
                doc.addPage();
                y = drawPageHeader();
            }
            y = drawTableHeader(y);

            for (let i = 0; i < group.items.length; i++) {
                if (y + ROW_H > PAGE_H - FOOTER_RESERVE) {
                    doc.addPage();
                    y = drawPageHeader();
                    y = drawTableHeader(y);
                }
                const item = group.items[i];
                if (i % 2 === 1) {
                    doc.rect(MARGIN, y, PAGE_W, ROW_H).fill('#f9fafb');
                }
                doc.fontSize(9).fillColor('#374151').font('Regular');
                let x = MARGIN + 4;
                doc.text(item.productName,           x,     y + 4, { width: COL_PRODUCT  - 8, lineBreak: false, ellipsis: true }); x += COL_PRODUCT;
                doc.text(item.category,              x + 4, y + 4, { width: COL_CATEGORY - 8, lineBreak: false }); x += COL_CATEGORY;
                doc.text(item.colourName || '-',     x + 4, y + 4, { width: COL_COLOUR   - 8, lineBreak: false }); x += COL_COLOUR;
                doc.text(item.packSize,              x + 4, y + 4, { width: COL_SIZE     - 8, lineBreak: false }); x += COL_SIZE;
                doc.fontSize(9).fillColor('#059669').font('Bold')
                   .text(formatINR(item.finalPrice), x,     y + 4, { width: COL_PRICE    - 4, align: 'right', lineBreak: false });
                doc.moveTo(MARGIN, y + ROW_H).lineTo(MARGIN + PAGE_W, y + ROW_H).strokeColor('#f1f5f9').lineWidth(0.3).stroke();
                y += ROW_H;
            }
            y += 10;
        }

        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            const fy = PAGE_H - 30;
            doc.moveTo(MARGIN, fy - 10).lineTo(MARGIN + PAGE_W, fy - 10).strokeColor('#d1d5db').lineWidth(0.5).stroke();
            doc.fontSize(7.5).fillColor('#9ca3af').font('Regular');
            doc.text('Prices inclusive of 18% GST  |  Valid as of ' + displayDate,
                     MARGIN, fy - 4, { width: 320, lineBreak: false });
            doc.text('Page ' + (i + 1) + ' of ' + totalPages,
                     MARGIN, fy - 4, { width: PAGE_W, align: 'right', lineBreak: false });
        }

        doc.flushPages();
        doc.end();
    });
}

module.exports = { computeFinalPrice, groupRowsForPdf, generatePriceListPdf };
