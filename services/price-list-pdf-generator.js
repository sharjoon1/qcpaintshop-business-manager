const PDFDocument = require('pdfkit');

const BRAND_GREEN = '#1B5E3B';
const COMPANY_NAME = 'Quality Colours';
const COMPANY_DETAIL = 'Quality Colours, Chennai  |  +91 74188 31122';

function computeFinalPrice(dpl, markupPercent) {
    const d = parseFloat(dpl);
    const m = parseFloat(markupPercent);
    if (!isFinite(d) || !isFinite(m)) return 0;
    return Math.ceil(d * (1 + m / 100) * 1.18);
}

function groupRowsForPdf(rows, brandLabel) {
    const catMap = new Map();
    for (const row of rows) {
        const cat = (row.category || 'Other').trim();
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push({
            productName: row.product || '',
            colourName: row.colourName || '',
            packSize: row.packSize || '',
            finalPrice: row.finalPrice || 0,
        });
    }
    const categories = [];
    for (const [label, items] of catMap) {
        items.sort((a, b) => {
            const n = (a.productName || '').localeCompare(b.productName || '');
            return n !== 0 ? n : (a.packSize || '').localeCompare(b.packSize || '');
        });
        categories.push({ label, items });
    }
    categories.sort((a, b) => a.label.localeCompare(b.label));
    return { brandLabel, categories };
}

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatINR(num) {
    return '₹ ' + Math.round(parseFloat(num) || 0).toLocaleString('en-IN');
}

module.exports = { computeFinalPrice, groupRowsForPdf };
