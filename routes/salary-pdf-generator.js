const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

function fmtINR(num) {
    const n = parseFloat(num) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate salary slip PDF
 * @param {Object} options - { salary, attendance, branding }
 * @param {WritableStream} stream - Response or file write stream
 */
function generateSalarySlipPDF(options, stream) {
    const { salary: s, branding } = options;

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.pipe(stream);

    const purple = '#667eea';
    const darkGray = '#333333';
    const medGray = '#666666';
    const lightGray = '#f5f5f5';

    const hourlyRate = parseFloat(s.base_salary || 0) / 260;
    const dailyRate = hourlyRate * 10;
    const stdDays = (parseFloat(s.total_standard_hours || 0) / 10);
    const sunDays = (parseFloat(s.total_sunday_hours || 0) / 10);
    const otDays = (parseFloat(s.total_overtime_hours || 0) / 10);
    const totalDays = stdDays + sunDays + otDays;

    // ===== HEADER =====
    const headerTop = 40;

    // Try to load company logo
    const logoPaths = [
        branding.business_logo ? path.join(__dirname, '..', 'public', 'uploads', 'logos', branding.business_logo) : null,
        path.join(__dirname, '..', 'public', 'logo.png')
    ].filter(Boolean);

    let logoLoaded = false;
    for (const logoPath of logoPaths) {
        if (fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, 40, headerTop, { height: 45 });
                logoLoaded = true;
                break;
            } catch {}
        }
    }

    const textStartX = logoLoaded ? 95 : 40;

    doc.fontSize(16).fillColor(purple).font('Helvetica-Bold')
        .text(branding.business_name || 'Quality Colours', textStartX, headerTop);

    doc.fontSize(8).fillColor(medGray).font('Helvetica');
    doc.text(branding.business_address || 'Ramanathapuram', textStartX, headerTop + 20);
    doc.text(`Phone: ${branding.business_phone || ''} | Email: ${branding.business_email || ''}`, textStartX, headerTop + 30);

    // Title - right side
    doc.fontSize(20).fillColor(purple).font('Helvetica-Bold')
        .text('SALARY SLIP', 350, headerTop, { width: 205, align: 'right' });

    // Month
    const monthLabel = formatMonth(s.salary_month);
    doc.fontSize(10).fillColor(darkGray).font('Helvetica')
        .text(monthLabel, 350, headerTop + 26, { width: 205, align: 'right' });

    // Divider
    doc.moveTo(40, headerTop + 55).lineTo(555, headerTop + 55)
        .strokeColor(purple).lineWidth(2).stroke();

    // ===== EMPLOYEE INFO =====
    let y = headerTop + 70;
    doc.fontSize(9).fillColor(medGray).font('Helvetica-Bold').text('EMPLOYEE', 40, y);
    doc.fontSize(12).fillColor(darkGray).font('Helvetica-Bold')
        .text(s.staff_name || '', 40, y + 14);
    doc.fontSize(9).fillColor(medGray).font('Helvetica');
    if (s.branch_name) doc.text(`Branch: ${s.branch_name}`, 40, y + 30);
    if (s.staff_phone) doc.text(`Phone: ${s.staff_phone}`, 40, y + 41);

    // Right side - salary period
    doc.fontSize(9).fillColor(medGray).font('Helvetica-Bold').text('PERIOD', 350, y, { width: 205, align: 'right' });
    doc.fontSize(9).fillColor(darkGray).font('Helvetica')
        .text(`${formatDate(s.from_date)} - ${formatDate(s.to_date)}`, 350, y + 14, { width: 205, align: 'right' })
        .text(`Base Salary: Rs.${fmtINR(s.base_salary)}/month`, 350, y + 28, { width: 205, align: 'right' })
        .text(`Daily Rate: Rs.${fmtINR(dailyRate)}/day (10 hrs)`, 350, y + 42, { width: 205, align: 'right' });

    // Light divider
    y += 60;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#ddd').lineWidth(0.5).stroke();

    // ===== ATTENDANCE SECTION =====
    y += 12;
    doc.fontSize(11).fillColor(purple).font('Helvetica-Bold').text('ATTENDANCE', 40, y);
    y += 18;

    const attRows = [
        ['Present Days', s.total_present_days || 0, 'Absent Days', s.total_absent_days || 0],
        ['Half Days', s.total_half_days || 0, 'Sundays Worked', s.total_sundays_worked || 0],
        ['Paid Leaves (Sun)', s.paid_sunday_leaves || 0, 'Paid Leaves (Wkday)', s.paid_weekday_leaves || 0],
        ['Excess Leaves', s.excess_leaves || 0, '', '']
    ];

    for (const row of attRows) {
        doc.fontSize(8).fillColor(medGray).font('Helvetica').text(row[0] + ':', 50, y, { width: 120 });
        doc.font('Helvetica-Bold').fillColor(darkGray).text(String(row[1]), 175, y, { width: 60 });
        if (row[2]) {
            doc.font('Helvetica').fillColor(medGray).text(row[2] + ':', 300, y, { width: 120 });
            doc.font('Helvetica-Bold').fillColor(darkGray).text(String(row[3]), 430, y, { width: 60 });
        }
        y += 15;
    }

    // ===== WORKING DAYS SECTION =====
    y += 5;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#ddd').lineWidth(0.5).stroke();
    y += 12;
    doc.fontSize(11).fillColor(purple).font('Helvetica-Bold').text('WORKING DAYS (10 hrs = 1 day)', 40, y);
    y += 18;

    const dayRows = [
        ['Standard Days', `${stdDays.toFixed(1)} days`, `${parseFloat(s.total_standard_hours || 0).toFixed(1)} hrs`],
        ['Sunday Days', `${sunDays.toFixed(1)} days`, `${parseFloat(s.total_sunday_hours || 0).toFixed(1)} hrs`],
        ['Overtime Days', `${otDays.toFixed(1)} days`, `${parseFloat(s.total_overtime_hours || 0).toFixed(1)} hrs`],
        ['Total', `${totalDays.toFixed(1)} days`, '']
    ];

    for (let i = 0; i < dayRows.length; i++) {
        const row = dayRows[i];
        const isTotal = i === dayRows.length - 1;
        if (isTotal) {
            doc.rect(40, y - 2, 515, 16).fill('#eef2ff');
        }
        doc.fontSize(8).fillColor(isTotal ? purple : medGray).font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
            .text(row[0] + ':', 50, y, { width: 120 });
        doc.font('Helvetica-Bold').fillColor(darkGray).text(row[1], 175, y, { width: 80 });
        if (row[2]) {
            doc.font('Helvetica').fillColor('#888').text(row[2], 260, y, { width: 80 });
        }
        y += 16;
    }

    // ===== EARNINGS TABLE =====
    y += 8;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#ddd').lineWidth(0.5).stroke();
    y += 12;
    doc.fontSize(11).fillColor(purple).font('Helvetica-Bold').text('EARNINGS', 40, y);
    y += 18;

    // Table header
    doc.rect(40, y - 2, 515, 16).fill('#eef2ff');
    doc.fontSize(8).fillColor(purple).font('Helvetica-Bold');
    doc.text('DESCRIPTION', 50, y, { width: 250 });
    doc.text('CALCULATION', 300, y, { width: 140 });
    doc.text('AMOUNT', 450, y, { width: 100, align: 'right' });
    y += 18;

    const earningRows = [];
    if (stdDays > 0) {
        earningRows.push(['Standard Work', `${stdDays.toFixed(1)} days × Rs.${fmtINR(dailyRate)}`, s.standard_hours_pay]);
    }
    if (sunDays > 0) {
        earningRows.push(['Sunday Work', `${sunDays.toFixed(1)} days × Rs.${fmtINR(dailyRate)}`, s.sunday_hours_pay]);
    }
    if (otDays > 0) {
        const otMult = s.overtime_multiplier || 1;
        earningRows.push(['Overtime', `${otDays.toFixed(1)} days × Rs.${fmtINR(dailyRate)} × ${otMult}x`, s.overtime_pay]);
    }
    if (parseFloat(s.total_allowances || 0) > 0) {
        earningRows.push(['Allowances', '', s.total_allowances]);
    }

    for (let i = 0; i < earningRows.length; i++) {
        const row = earningRows[i];
        if (i % 2 === 1) doc.rect(40, y - 2, 515, 15).fill(lightGray);
        doc.fontSize(8).fillColor(darkGray).font('Helvetica')
            .text(row[0], 50, y, { width: 250 });
        doc.text(row[1], 300, y, { width: 140 });
        doc.font('Helvetica-Bold').text('Rs.' + fmtINR(row[2]), 450, y, { width: 100, align: 'right' });
        y += 16;
    }

    // Gross total
    doc.rect(40, y, 515, 18).fill('#eef2ff');
    doc.fontSize(9).fillColor(purple).font('Helvetica-Bold')
        .text('GROSS SALARY', 50, y + 4, { width: 350 });
    doc.text('Rs.' + fmtINR(s.gross_salary), 450, y + 4, { width: 100, align: 'right' });
    y += 24;

    // ===== DEDUCTIONS TABLE =====
    const totalDeductions = parseFloat(s.total_deductions || 0);
    if (totalDeductions > 0) {
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#ddd').lineWidth(0.5).stroke();
        y += 12;
        doc.fontSize(11).fillColor('#dc3545').font('Helvetica-Bold').text('DEDUCTIONS', 40, y);
        y += 18;

        // Table header
        doc.rect(40, y - 2, 515, 16).fill('#fff5f5');
        doc.fontSize(8).fillColor('#dc3545').font('Helvetica-Bold');
        doc.text('DESCRIPTION', 50, y, { width: 250 });
        doc.text('CALCULATION', 300, y, { width: 140 });
        doc.text('AMOUNT', 450, y, { width: 100, align: 'right' });
        y += 18;

        const dedRows = [];
        if (parseFloat(s.late_deduction || 0) > 0) {
            dedRows.push(['Late Deduction', '', s.late_deduction]);
        }
        if (parseFloat(s.absence_deduction || 0) > 0) {
            dedRows.push(['Absence', `${s.total_absent_days || 0} days × Rs.${fmtINR(dailyRate)}`, s.absence_deduction]);
        }
        if (parseFloat(s.leave_deduction || 0) > 0) {
            dedRows.push(['Excess Leave', `${s.excess_leaves || 0} days × Rs.${fmtINR(dailyRate)}`, s.leave_deduction]);
        }
        if (parseFloat(s.other_deduction || 0) > 0) {
            dedRows.push(['Other Deduction', '', s.other_deduction]);
        }

        for (let i = 0; i < dedRows.length; i++) {
            const row = dedRows[i];
            if (i % 2 === 1) doc.rect(40, y - 2, 515, 15).fill(lightGray);
            doc.fontSize(8).fillColor(darkGray).font('Helvetica')
                .text(row[0], 50, y, { width: 250 });
            doc.text(row[1], 300, y, { width: 140 });
            doc.font('Helvetica-Bold').fillColor('#dc3545').text('-Rs.' + fmtINR(row[2]), 450, y, { width: 100, align: 'right' });
            y += 16;
        }

        // Total deductions
        doc.rect(40, y, 515, 18).fill('#fff5f5');
        doc.fontSize(9).fillColor('#dc3545').font('Helvetica-Bold')
            .text('TOTAL DEDUCTIONS', 50, y + 4, { width: 350 });
        doc.text('-Rs.' + fmtINR(s.total_deductions), 450, y + 4, { width: 100, align: 'right' });
        y += 24;
    }

    // ===== NET SALARY BOX =====
    y += 5;
    doc.rect(40, y, 515, 40).fill(purple);
    doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
        .text('NET SALARY', 60, y + 12, { width: 300 });
    doc.fontSize(16).text('Rs.' + fmtINR(s.net_salary), 350, y + 11, { width: 195, align: 'right' });

    // ===== FOOTER =====
    y += 60;
    doc.fontSize(7).fillColor('#999').font('Helvetica')
        .text('This is a system-generated salary slip. For queries, contact your HR department.', 40, y, { align: 'center', width: 515 });
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`, 40, y + 12, { align: 'center', width: 515 });

    doc.end();
}

function formatMonth(monthStr) {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[parseInt(month) - 1]} ${year}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

module.exports = { generateSalarySlipPDF };
