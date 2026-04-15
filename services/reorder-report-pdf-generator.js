const PDFDocument = require('pdfkit');
const fs = require('fs');

const COLORS = {
    primary: '#1B5E3B',
    primaryLight: '#2E7D4F',
    gold: '#D4A24E',
    danger: '#DC2626',
    warning: '#F59E0B',
    medium: '#EAB308',
    low: '#6B7280',
    bg: '#F9FAFB',
    text: '#1F2937',
    mute: '#6B7280'
};

function severityColor(sev) {
    if (sev === 'critical') return COLORS.danger;
    if (sev === 'high') return COLORS.warning;
    if (sev === 'medium') return COLORS.medium;
    return COLORS.low;
}

/**
 * Generate a Reorder Report PDF.
 * @param {Object} report - Report object from reorder-report-service::assembleReport()
 *   { report_date, scope, rows: [{ item_name, sku, brand, unit, branch_id, branch_name,
 *     current_stock, reorder_level, severity, avg_daily_sales, days_to_stockout,
 *     suggested_order_qty, other_branches: [{ branch_name, stock_on_hand }] }] }
 * @param {string} outPath - Absolute path where the PDF will be saved.
 * @returns {Promise<string>} Resolves to outPath when fully written.
 */
async function generateReorderPdf(report, outPath) {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    // ===== HEADER =====
    doc.fillColor(COLORS.primary).fontSize(20).text('Reorder Report', { align: 'left' });
    doc.fillColor(COLORS.gold).fontSize(11).text('Quality Colours - Stock Replenishment Alert');
    doc.moveDown(0.5);
    const windowDays = report.window_days || 60;
    const PERIOD_LABELS = { 1: 'Day', 7: 'Week', 14: '2 Weeks', 30: 'Month', 90: '3 Months', 180: '6 Months' };
    const periodLabel = PERIOD_LABELS[windowDays] || `${windowDays}d`;
    const periodShort = { 1: 'd', 7: 'wk', 14: '2wk', 30: 'mo', 90: '3mo', 180: '6mo' }[windowDays] || 'd';
    doc.fillColor(COLORS.text).fontSize(9).text(
        `Report date: ${report.report_date}   Scope: ${report.scope}   Period: ${periodLabel}   Items: ${report.rows.length}`
    );
    doc.moveDown();

    // ===== SUMMARY =====
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    report.rows.forEach(r => { counts[r.severity] = (counts[r.severity] || 0) + 1; });
    doc.fontSize(10).fillColor(COLORS.primaryLight).text(
        `Critical: ${counts.critical}   High: ${counts.high}   Medium: ${counts.medium}   Low: ${counts.low}`
    );
    doc.moveDown();

    // ===== GROUP BY BRANCH =====
    const byBranch = new Map();
    report.rows.forEach(r => {
        const key = r.branch_name || 'Unknown';
        if (!byBranch.has(key)) byBranch.set(key, []);
        byBranch.get(key).push(r);
    });

    for (const [branchName, rows] of byBranch.entries()) {
        if (doc.y > 720) doc.addPage();

        // Branch heading
        doc.fontSize(13).fillColor(COLORS.primary).text(branchName);
        doc.moveDown(0.3);

        for (const r of rows) {
            if (doc.y > 730) doc.addPage();

            const severityC = severityColor(r.severity);
            const top = doc.y;

            // Card background
            doc.rect(40, top, 515, 60).fillAndStroke(COLORS.bg, '#E5E7EB');

            // Severity badge
            doc.fillColor(severityC).fontSize(8).text(r.severity.toUpperCase(), 48, top + 5);

            // Item name
            doc.fillColor(COLORS.text).fontSize(11).text(
                r.item_name || '', 48, top + 17, { width: 370, ellipsis: true, height: 14 }
            );

            // Sub-line: SKU / brand / unit
            doc.fontSize(8).fillColor(COLORS.mute).text(
                `SKU: ${r.sku || '-'}   Brand: ${r.brand || '-'}   Unit: ${r.unit || '-'}`,
                48, top + 32, { width: 370, height: 10 }
            );

            // Metrics block (right side)
            const metricsX = 430;
            doc.fontSize(8).fillColor(COLORS.text);
            doc.text(`Stock: ${r.current_stock}`, metricsX, top + 5);
            doc.text(`Reorder @: ${r.reorder_level}`, metricsX, top + 15);
            const periodValue = (Number(r.avg_daily_sales) || 0) * windowDays;
            doc.text(`Avg/${periodShort}: ${periodValue.toFixed(2)}`, metricsX, top + 25);
            doc.fillColor(COLORS.gold).text(`Order: ${r.suggested_order_qty}`, metricsX, top + 37);

            // Other branches compact line
            if (r.other_branches && r.other_branches.length > 0) {
                const others = r.other_branches.slice(0, 6)
                    .map(o => `${o.branch_name}: ${o.stock_on_hand}`).join('  |  ');
                doc.fontSize(7).fillColor(COLORS.primaryLight).text(
                    `Other: ${others}`, 48, top + 45, { width: 500, height: 10 }
                );
            }

            doc.y = top + 62;
        }

        doc.moveDown(0.3);
    }

    doc.end();

    return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(outPath));
        stream.on('error', reject);
    });
}

module.exports = { generateReorderPdf };
