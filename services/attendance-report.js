/**
 * ATTENDANCE DAILY REPORT SERVICE
 * Generates daily attendance summaries and sends via WhatsApp + in-app notifications
 * Also generates admin PDF summary report
 * Cron: 10:05 PM IST daily
 */

const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const notificationService = require('./notification-service');

let pool;
let io;
let whatsappSessionManager;
let registry = null;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }
function setSessionManager(sm) { whatsappSessionManager = sm; }
function setAutomationRegistry(r) { registry = r; }

/**
 * Format minutes into "Xh Ym" display
 */
function formatMinutes(mins) {
    if (!mins || mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/**
 * Format time from Date to "HH:MM AM/PM"
 */
function formatTime(date) {
    if (!date) return '--:--';
    const d = new Date(date);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/**
 * Get today's date string in IST (YYYY-MM-DD)
 */
function getTodayIST() {
    const now = new Date();
    return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA gives YYYY-MM-DD
}

/**
 * Generate report data for a staff member on a date
 * Returns { text, data } or null if no attendance
 */
async function generateReport(userId, date) {
    if (!pool) return null;

    try {
        const [records] = await pool.query(
            `SELECT a.*, u.full_name, u.phone, b.name as branch_name
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.user_id = ? AND a.date = ?
             ORDER BY a.id ASC`,
            [userId, date]
        );

        if (records.length === 0) return null;

        const staff = records[0];
        const totalWorking = records.reduce((s, r) => s + (r.total_working_minutes || 0), 0);
        const totalBreak = records.reduce((s, r) => s + (r.break_duration_minutes || 0), 0);
        const totalOutside = records.reduce((s, r) => s + (r.outside_work_minutes || 0), 0);
        const totalPrayer = records.reduce((s, r) => s + (r.prayer_minutes || 0), 0);
        const totalOvertime = records.reduce((s, r) => s + (r.overtime_minutes || 0), 0);
        const shopTime = Math.max(0, totalWorking - totalOutside - totalPrayer);

        const clockIn = formatTime(staff.clock_in_time);
        const clockOut = staff.clock_out_time ? formatTime(staff.clock_out_time) : 'Still working';
        const isComplete = staff.clock_out_time ? (totalWorking >= (staff.expected_hours || 10) * 60) : false;
        const status = !staff.clock_out_time ? 'Still Working' : (isComplete ? 'Complete' : 'Incomplete');
        const autoClockoutNote = staff.auto_clockout_type === 'end_of_day' ? '\n-- Auto clock-out at 10 PM' : '';

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        const overtimeLine = totalOvertime > 0 ? `\n*Overtime: ${formatMinutes(totalOvertime)}*` : '';

        const text = `*Daily Attendance Report*
---
*${staff.full_name}*
${staff.branch_name}
${dateStr}
---
Clock In: ${clockIn}
Clock Out: ${clockOut}

*Time Breakdown:*
Shop Time: ${formatMinutes(shopTime)}
Outside Work: ${formatMinutes(totalOutside)}
Prayer: ${formatMinutes(totalPrayer)}
Break: ${formatMinutes(totalBreak)}
---
*Total Working: ${formatMinutes(totalWorking)}*${overtimeLine}
Status: ${status}${autoClockoutNote}

_QC Paint Shop - Auto Report_`;

        return {
            text,
            data: {
                user_id: userId,
                full_name: staff.full_name,
                phone: staff.phone,
                branch_name: staff.branch_name,
                branch_id: staff.branch_id,
                clock_in: clockIn,
                clock_out: clockOut,
                total_working: totalWorking,
                total_break: totalBreak,
                total_outside: totalOutside,
                total_prayer: totalPrayer,
                total_overtime: totalOvertime,
                shop_time: shopTime,
                status,
                is_late: staff.is_late,
                late_minutes: staff.late_minutes || 0
            }
        };
    } catch (error) {
        console.error('[AttendanceReport] generateReport error:', error.message);
        return null;
    }
}

/**
 * Send report to a single staff member via WhatsApp + in-app notification
 */
async function sendReport(userId, date, sentBy) {
    if (!pool) return { success: false, message: 'Database not available' };

    try {
        const report = await generateReport(userId, date);
        if (!report) {
            return { success: false, message: 'No attendance data found' };
        }

        let deliveryStatus = 'notification';
        const phone = report.data.phone;

        // 1. Always send in-app notification
        try {
            await notificationService.send(userId, {
                type: 'attendance_report',
                title: 'Daily Attendance Report',
                body: `Working: ${formatMinutes(report.data.total_working)} | Status: ${report.data.status}`,
                data: { date, working: report.data.total_working, status: report.data.status }
            });
        } catch (e) {
            console.error(`[AttendanceReport] Notification error for user ${userId}:`, e.message);
        }

        // 2. Try WhatsApp if session manager available and phone exists
        if (whatsappSessionManager && phone) {
            let waPhone = phone.replace(/[^0-9]/g, '');
            if (waPhone.length === 10) waPhone = '91' + waPhone;

            try {
                const sent = await whatsappSessionManager.sendMessage(
                    report.data.branch_id,
                    waPhone,
                    report.text
                );
                if (sent) deliveryStatus = 'sent';
            } catch (err) {
                console.error('[AttendanceReport] WhatsApp send error:', err.message);
            }
        }

        // 3. Log to database
        await pool.query(
            `INSERT INTO attendance_daily_reports (user_id, branch_id, report_date, sent_via, sent_by, sent_at, report_text, delivery_status)
             VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE sent_via = VALUES(sent_via), sent_by = VALUES(sent_by), sent_at = NOW(),
                report_text = VALUES(report_text), delivery_status = VALUES(delivery_status)`,
            [userId, report.data.branch_id, date, deliveryStatus === 'sent' ? 'whatsapp' : 'notification', sentBy || null, report.text, deliveryStatus]
        );

        if (io && sentBy) {
            io.to(`user_${sentBy}`).emit('report_send_progress', {
                user_id: userId,
                full_name: report.data.full_name,
                status: deliveryStatus
            });
        }

        return {
            success: true,
            message: `Report sent to ${report.data.full_name} (${deliveryStatus})`,
            delivery_status: deliveryStatus,
            report
        };
    } catch (error) {
        console.error('[AttendanceReport] sendReport error:', error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Send reports to all staff who clocked in on a date
 */
async function sendAllReports(date, sentBy) {
    if (!pool) return { sent: 0, failed: 0, total: 0 };

    try {
        const [staff] = await pool.query(
            `SELECT DISTINCT a.user_id
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND u.role NOT IN ('customer', 'super_admin')
             ORDER BY a.user_id`,
            [date]
        );

        console.log(`[AttendanceReport] Sending reports for ${date} to ${staff.length} staff`);

        let sent = 0, failed = 0;
        const reports = [];

        for (const s of staff) {
            const result = await sendReport(s.user_id, date, sentBy);
            if (result.success) {
                sent++;
                if (result.report) reports.push(result.report);
            } else {
                failed++;
            }

            // 1 second delay between sends
            if (staff.indexOf(s) < staff.length - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        console.log(`[AttendanceReport] Done: ${sent} sent, ${failed} failed`);

        if (io && sentBy) {
            io.to(`user_${sentBy}`).emit('report_send_complete', { date, total: staff.length, sent, failed });
        }

        return { sent, failed, total: staff.length, reports };
    } catch (error) {
        console.error('[AttendanceReport] sendAllReports error:', error.message);
        return { sent: 0, failed: 0, total: 0 };
    }
}

// ─── Admin PDF Report ──────────────────────────────────────────

/**
 * Generate PDF summary of all staff attendance for a date
 */
async function generateAdminPDF(date) {
    if (!pool) return null;

    try {
        const [rows] = await pool.query(
            `SELECT a.user_id, u.full_name, b.name as branch_name,
                    a.clock_in_time, a.clock_out_time,
                    a.total_working_minutes, a.break_duration_minutes,
                    a.outside_work_minutes, a.prayer_minutes, a.overtime_minutes,
                    a.status, a.is_late, a.late_minutes, a.auto_clockout_type
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.date = ?
             ORDER BY b.name, u.full_name`,
            [date]
        );

        if (rows.length === 0) return null;

        // Ensure uploads dir
        const dir = path.join(__dirname, '..', 'public', 'uploads', 'reports');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filename = `attendance-${date}.pdf`;
        const filepath = path.join(dir, filename);

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
            const stream = fs.createWriteStream(filepath);
            doc.pipe(stream);

            // Header
            doc.fontSize(18).font('Helvetica-Bold').text('Quality Colours - Daily Attendance Report', { align: 'center' });
            doc.fontSize(12).font('Helvetica').text(dateStr, { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(10).text(`Total Staff: ${rows.length} | Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'center' });
            doc.moveDown(1);

            // Table headers
            const headers = ['#', 'Name', 'Branch', 'Clock In', 'Clock Out', 'Working', 'Break', 'OT', 'Status', 'Late'];
            const colWidths = [25, 120, 100, 65, 65, 55, 50, 45, 70, 50];
            const startX = 40;
            let y = doc.y;

            // Header row
            doc.font('Helvetica-Bold').fontSize(8);
            let x = startX;
            headers.forEach((h, i) => {
                doc.text(h, x, y, { width: colWidths[i], align: 'left' });
                x += colWidths[i] + 5;
            });
            y += 15;
            doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 5, y).stroke();
            y += 5;

            // Data rows
            doc.font('Helvetica').fontSize(7.5);
            let totalWorkingAll = 0;
            let totalOTAll = 0;
            let lateCount = 0;

            rows.forEach((row, idx) => {
                if (y > 520) {
                    doc.addPage({ layout: 'landscape' });
                    y = 40;
                    // Repeat headers on new page
                    doc.font('Helvetica-Bold').fontSize(8);
                    x = startX;
                    headers.forEach((h, i) => {
                        doc.text(h, x, y, { width: colWidths[i], align: 'left' });
                        x += colWidths[i] + 5;
                    });
                    y += 15;
                    doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 5, y).stroke();
                    y += 5;
                    doc.font('Helvetica').fontSize(7.5);
                }

                const working = row.total_working_minutes || 0;
                const breakMins = row.break_duration_minutes || 0;
                const ot = row.overtime_minutes || 0;
                const status = row.auto_clockout_type === 'end_of_day' ? 'Auto-Out' : (row.status || 'present');
                const late = row.is_late ? `${row.late_minutes || 0}m` : '-';

                totalWorkingAll += working;
                totalOTAll += ot;
                if (row.is_late) lateCount++;

                x = startX;
                const vals = [
                    String(idx + 1),
                    row.full_name,
                    row.branch_name,
                    formatTime(row.clock_in_time),
                    row.clock_out_time ? formatTime(row.clock_out_time) : 'Working',
                    formatMinutes(working),
                    formatMinutes(breakMins),
                    ot > 0 ? formatMinutes(ot) : '-',
                    status.charAt(0).toUpperCase() + status.slice(1),
                    late
                ];

                // Alternate row background
                if (idx % 2 === 0) {
                    doc.rect(startX - 2, y - 2, colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 5 + 4, 14).fill('#f8f9fa').fillColor('black');
                }

                vals.forEach((v, i) => {
                    doc.text(v, x, y, { width: colWidths[i], align: 'left' });
                    x += colWidths[i] + 5;
                });
                y += 14;
            });

            // Summary footer
            y += 10;
            doc.moveTo(startX, y).lineTo(startX + 400, y).stroke();
            y += 8;
            doc.font('Helvetica-Bold').fontSize(9);
            doc.text(`Summary: ${rows.length} staff | Total Working: ${formatMinutes(totalWorkingAll)} | Total OT: ${formatMinutes(totalOTAll)} | Late: ${lateCount}`, startX, y);

            doc.end();

            stream.on('finish', () => {
                resolve({ filepath, filename, url: `/uploads/reports/${filename}`, staffCount: rows.length });
            });
            stream.on('error', reject);
        });
    } catch (error) {
        console.error('[AttendanceReport] generateAdminPDF error:', error.message);
        return null;
    }
}

/**
 * Send admin summary PDF + text via WhatsApp
 */
async function sendAdminReport(date) {
    if (!pool) return;

    try {
        // Get admin users
        const [admins] = await pool.query(
            `SELECT id, full_name, phone FROM users WHERE role = 'admin' AND status = 'active'`
        );

        if (admins.length === 0) {
            console.log('[AttendanceReport] No admin users found');
            return;
        }

        // Generate PDF
        const pdf = await generateAdminPDF(date);

        // Generate text summary
        const [summary] = await pool.query(
            `SELECT COUNT(*) as total,
                    SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END) as late_count,
                    SUM(CASE WHEN a.clock_out_time IS NULL THEN 1 ELSE 0 END) as still_working,
                    ROUND(AVG(a.total_working_minutes), 0) as avg_working,
                    SUM(a.total_working_minutes) as total_working,
                    SUM(a.overtime_minutes) as total_ot
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND u.role NOT IN ('customer', 'super_admin')`, [date]
        );

        const s = summary[0];
        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        const adminText = `*Admin Attendance Summary*
---
${dateStr}
---
Total Staff: ${s.total}
Late Arrivals: ${s.late_count || 0}
Still Working: ${s.still_working || 0}
Avg Working: ${formatMinutes(s.avg_working || 0)}
Total Hours: ${formatMinutes(s.total_working || 0)}
Total OT: ${formatMinutes(s.total_ot || 0)}
${pdf ? `\nPDF: https://act.qcpaintshop.com${pdf.url}` : ''}
---
_QC Paint Shop - Admin Report_`;

        for (const admin of admins) {
            // In-app notification
            try {
                await notificationService.send(admin.id, {
                    type: 'admin_attendance_report',
                    title: 'Daily Attendance Summary',
                    body: `${s.total} staff | Avg: ${formatMinutes(s.avg_working || 0)} | Late: ${s.late_count || 0}`,
                    data: { date, pdf_url: pdf?.url, total: s.total }
                });
            } catch (e) {
                console.error(`[AttendanceReport] Admin notification error:`, e.message);
            }

            // WhatsApp
            if (whatsappSessionManager && admin.phone) {
                let waPhone = admin.phone.replace(/[^0-9]/g, '');
                if (waPhone.length === 10) waPhone = '91' + waPhone;

                try {
                    await whatsappSessionManager.sendMessage(0, waPhone, adminText);

                    // Send PDF as document if available
                    if (pdf) {
                        try {
                            await whatsappSessionManager.sendMessage(0, waPhone, null, {
                                source: 'attendance_report',
                                document: { path: pdf.filepath, filename: pdf.filename }
                            });
                        } catch (docErr) {
                            console.error('[AttendanceReport] PDF send error:', docErr.message);
                        }
                    }
                } catch (err) {
                    console.error('[AttendanceReport] Admin WhatsApp error:', err.message);
                }
            }
        }

        console.log(`[AttendanceReport] Admin report sent to ${admins.length} admin(s)`);
    } catch (error) {
        console.error('[AttendanceReport] sendAdminReport error:', error.message);
    }
}

// ─── Activity Report ──────────────────────────────────────────

/**
 * Generate daily activity report data for all staff on a date
 * Returns array of staff objects with activity breakdown + idle time
 */
async function generateActivityReportData(date) {
    if (!pool) return [];

    try {
        // Get all staff who clocked in on this date
        const [staff] = await pool.query(
            `SELECT a.user_id, u.full_name, b.name as branch_name, a.branch_id,
                    a.clock_in_time, a.clock_out_time,
                    a.total_working_minutes, a.break_duration_minutes,
                    a.outside_work_minutes, a.prayer_minutes, a.overtime_minutes
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.date = ? AND u.role NOT IN ('customer', 'super_admin')
             ORDER BY b.name, u.full_name`,
            [date]
        );

        if (staff.length === 0) return [];

        // Get activity sessions for all staff on this date
        const [sessions] = await pool.query(
            `SELECT user_id, activity_type,
                    SUM(COALESCE(duration_minutes, TIMESTAMPDIFF(MINUTE, started_at, COALESCE(ended_at, NOW())))) as total_minutes,
                    COUNT(*) as session_count
             FROM staff_activity_sessions
             WHERE DATE(started_at) = ?
             GROUP BY user_id, activity_type`,
            [date]
        );

        // Build a map: userId -> { activityType -> minutes }
        const activityMap = {};
        for (const s of sessions) {
            if (!activityMap[s.user_id]) activityMap[s.user_id] = {};
            activityMap[s.user_id][s.activity_type] = {
                minutes: Math.round(s.total_minutes || 0),
                count: s.session_count
            };
        }

        // Build report data per staff
        const reportData = staff.map(s => {
            const activities = activityMap[s.user_id] || {};
            const totalActiveMinutes = Object.values(activities).reduce((sum, a) => sum + a.minutes, 0);
            const totalWorking = s.total_working_minutes || 0;
            const breakMins = s.break_duration_minutes || 0;
            const prayerMins = s.prayer_minutes || 0;
            const outsideMins = s.outside_work_minutes || 0;

            // Idle = total working - active - break - prayer - outside
            const idleMinutes = Math.max(0, totalWorking - totalActiveMinutes - breakMins - prayerMins - outsideMins);

            return {
                user_id: s.user_id,
                full_name: s.full_name,
                branch_name: s.branch_name,
                branch_id: s.branch_id,
                clock_in: formatTime(s.clock_in_time),
                clock_out: s.clock_out_time ? formatTime(s.clock_out_time) : 'Still working',
                total_working: totalWorking,
                break_minutes: breakMins,
                prayer_minutes: prayerMins,
                outside_minutes: outsideMins,
                activities,
                total_active: totalActiveMinutes,
                idle_minutes: idleMinutes,
                idle_percent: totalWorking > 0 ? Math.round((idleMinutes / totalWorking) * 100) : 0
            };
        });

        return reportData;
    } catch (error) {
        console.error('[ActivityReport] generateActivityReportData error:', error.message);
        return [];
    }
}

/**
 * Generate PDF of daily activity report for all staff
 */
async function generateActivityPDF(date) {
    if (!pool) return null;

    try {
        const reportData = await generateActivityReportData(date);
        if (reportData.length === 0) return null;

        const dir = path.join(__dirname, '..', 'public', 'uploads', 'reports');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filename = `activity-report-${date}.pdf`;
        const filepath = path.join(dir, filename);

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        // Activity type labels (short)
        const activityTypes = [
            { key: 'marketing', label: 'MKT' },
            { key: 'outstanding_followup', label: 'OUT' },
            { key: 'material_arrangement', label: 'MAT' },
            { key: 'material_receiving', label: 'RCV' },
            { key: 'attending_customer', label: 'CUS' },
            { key: 'shop_maintenance', label: 'SHP' }
        ];

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 30, layout: 'landscape' });
            const stream = fs.createWriteStream(filepath);
            doc.pipe(stream);

            // Header
            doc.fontSize(16).font('Helvetica-Bold').text('Quality Colours - Daily Activity Report', { align: 'center' });
            doc.fontSize(11).font('Helvetica').text(dateStr, { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(9).text(`Total Staff: ${reportData.length} | Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'center' });
            doc.moveDown(0.8);

            // Table columns
            const headers = ['#', 'Name', 'Branch', 'In', 'Out', ...activityTypes.map(a => a.label), 'Active', 'Idle*', 'Idle%'];
            const colWidths = [20, 95, 75, 50, 50, 42, 42, 42, 42, 42, 42, 48, 48, 38];
            const startX = 30;
            let y = doc.y;

            // Header row
            doc.font('Helvetica-Bold').fontSize(7);
            let x = startX;
            headers.forEach((h, i) => {
                doc.text(h, x, y, { width: colWidths[i], align: 'center' });
                x += colWidths[i] + 3;
            });
            y += 14;
            const tableWidth = colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 3;
            doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
            y += 4;

            // Data rows
            doc.font('Helvetica').fontSize(7);
            let totalActive = 0, totalIdle = 0;

            reportData.forEach((row, idx) => {
                if (y > 520) {
                    doc.addPage({ layout: 'landscape' });
                    y = 30;
                    doc.font('Helvetica-Bold').fontSize(7);
                    x = startX;
                    headers.forEach((h, i) => {
                        doc.text(h, x, y, { width: colWidths[i], align: 'center' });
                        x += colWidths[i] + 3;
                    });
                    y += 14;
                    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
                    y += 4;
                    doc.font('Helvetica').fontSize(7);
                }

                totalActive += row.total_active;
                totalIdle += row.idle_minutes;

                // Alternate row bg
                if (idx % 2 === 0) {
                    doc.rect(startX - 2, y - 2, tableWidth + 4, 13).fill('#f8f9fa').fillColor('black');
                }

                const vals = [
                    String(idx + 1),
                    row.full_name,
                    row.branch_name,
                    row.clock_in,
                    row.clock_out,
                    ...activityTypes.map(a => {
                        const mins = row.activities[a.key]?.minutes || 0;
                        return mins > 0 ? formatMinutes(mins) : '-';
                    }),
                    formatMinutes(row.total_active),
                    formatMinutes(row.idle_minutes),
                    row.idle_percent + '%'
                ];

                x = startX;
                vals.forEach((v, i) => {
                    const align = i <= 2 ? 'left' : 'center';
                    doc.text(v, x, y, { width: colWidths[i], align });
                    x += colWidths[i] + 3;
                });
                y += 13;
            });

            // Footer
            y += 8;
            doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
            y += 6;
            doc.font('Helvetica-Bold').fontSize(8);
            doc.text(`Summary: ${reportData.length} staff | Total Active: ${formatMinutes(totalActive)} | Total Idle: ${formatMinutes(totalIdle)}`, startX, y);
            y += 14;
            doc.font('Helvetica').fontSize(7).fillColor('#666666');
            doc.text('* Idle = Total Working - Active Activities - Break - Prayer - Outside Work', startX, y);

            doc.end();

            stream.on('finish', () => {
                resolve({ filepath, filename, url: `/uploads/reports/${filename}`, staffCount: reportData.length });
            });
            stream.on('error', reject);
        });
    } catch (error) {
        console.error('[ActivityReport] generateActivityPDF error:', error.message);
        return null;
    }
}

/**
 * Send daily activity report to admin users (notification + WhatsApp + PDF)
 */
async function sendActivityAdminReport(date) {
    if (!pool) return;

    try {
        const [admins] = await pool.query(
            `SELECT id, full_name, phone FROM users WHERE role = 'admin' AND status = 'active'`
        );
        if (admins.length === 0) return;

        const reportData = await generateActivityReportData(date);
        if (reportData.length === 0) {
            console.log('[ActivityReport] No activity data for', date);
            return;
        }

        const pdf = await generateActivityPDF(date);

        // Build text summary
        const totalActive = reportData.reduce((s, r) => s + r.total_active, 0);
        const totalIdle = reportData.reduce((s, r) => s + r.idle_minutes, 0);
        const avgIdlePct = reportData.length > 0
            ? Math.round(reportData.reduce((s, r) => s + r.idle_percent, 0) / reportData.length)
            : 0;

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        // Top 3 idle staff
        const topIdle = [...reportData].sort((a, b) => b.idle_minutes - a.idle_minutes).slice(0, 3);
        let idleList = topIdle.map(s => `  ${s.full_name}: ${formatMinutes(s.idle_minutes)} (${s.idle_percent}%)`).join('\n');

        const adminText = `*Daily Activity Report*
---
${dateStr}
---
Total Staff: ${reportData.length}
Total Active Time: ${formatMinutes(totalActive)}
வேலை செய்யாமல் இருந்த மொத்த நேரம்: ${formatMinutes(totalIdle)}
Avg Idle: ${avgIdlePct}%

*அதிக நேரம் வேலை செய்யாமல் இருந்தவர்கள்:*
${idleList}
${pdf ? `\nPDF: https://act.qcpaintshop.com${pdf.url}` : ''}
---
_QC Paint Shop - Activity Report_`;

        for (const admin of admins) {
            try {
                await notificationService.send(admin.id, {
                    type: 'admin_activity_report',
                    title: 'Daily Activity Report',
                    body: `${reportData.length} staff | Active: ${formatMinutes(totalActive)} | Idle: ${formatMinutes(totalIdle)} (${avgIdlePct}%)`,
                    data: { date, pdf_url: pdf?.url, total: reportData.length }
                });
            } catch (e) {
                console.error('[ActivityReport] Admin notification error:', e.message);
            }

            if (whatsappSessionManager && admin.phone) {
                let waPhone = admin.phone.replace(/[^0-9]/g, '');
                if (waPhone.length === 10) waPhone = '91' + waPhone;
                try {
                    await whatsappSessionManager.sendMessage(0, waPhone, adminText);
                    if (pdf) {
                        try {
                            await whatsappSessionManager.sendMessage(0, waPhone, null, {
                                source: 'activity_report',
                                document: { path: pdf.filepath, filename: pdf.filename }
                            });
                        } catch (docErr) {
                            console.error('[ActivityReport] PDF send error:', docErr.message);
                        }
                    }
                } catch (err) {
                    console.error('[ActivityReport] Admin WhatsApp error:', err.message);
                }
            }
        }

        console.log(`[ActivityReport] Admin activity report sent to ${admins.length} admin(s)`);
    } catch (error) {
        console.error('[ActivityReport] sendActivityAdminReport error:', error.message);
    }
}

// ─── Lead Alerts ───────────────────────────────────────────────

/**
 * Send lead creation + follow-up alerts to staff
 */
async function sendLeadAlerts(date) {
    if (!pool) return;

    try {
        // Get all active staff
        const [staff] = await pool.query(
            `SELECT u.id, u.full_name, u.phone, u.branch_id FROM users u
             WHERE u.status = 'active' AND u.role IN ('staff', 'manager')
             ORDER BY u.id`
        );

        for (const user of staff) {
            // 1. Check if they created any leads today
            const [leadsToday] = await pool.query(
                `SELECT COUNT(*) as count FROM leads WHERE created_by = ? AND DATE(created_at) = ?`,
                [user.id, date]
            );

            // 2. Check overdue followups
            const [overdue] = await pool.query(
                `SELECT COUNT(*) as count FROM leads
                 WHERE assigned_to = ? AND next_followup_date < ? AND status NOT IN ('won','lost','inactive')`,
                [user.id, date]
            );

            // 3. Check today's followups
            const [todayFollowups] = await pool.query(
                `SELECT COUNT(*) as count FROM leads
                 WHERE assigned_to = ? AND next_followup_date = ? AND status NOT IN ('won','lost','inactive')`,
                [user.id, date]
            );

            // 4. Check followups done today (with notes)
            const [followupsDone] = await pool.query(
                `SELECT COUNT(*) as count FROM lead_followups
                 WHERE user_id = ? AND DATE(created_at) = ?`,
                [user.id, date]
            );

            const alerts = [];

            // Alert: No leads created
            if (leadsToday[0].count === 0) {
                alerts.push({
                    type: 'lead_creation_alert',
                    title: 'Lead Creation Reminder',
                    body: 'You have not created any leads today. Please add new leads from walk-ins, calls, or referrals.',
                    priority: 'medium'
                });
            }

            // Alert: Overdue followups
            if (overdue[0].count > 0) {
                alerts.push({
                    type: 'lead_overdue_alert',
                    title: 'Overdue Follow-ups!',
                    body: `You have ${overdue[0].count} overdue follow-up${overdue[0].count > 1 ? 's' : ''}. Please contact them immediately.`,
                    priority: 'high'
                });
            }

            // Alert: Today's followups not done
            if (todayFollowups[0].count > 0 && followupsDone[0].count < todayFollowups[0].count) {
                const remaining = todayFollowups[0].count - followupsDone[0].count;
                alerts.push({
                    type: 'lead_followup_reminder',
                    title: 'Pending Follow-ups Today',
                    body: `${remaining} follow-up${remaining > 1 ? 's' : ''} still pending for today. Complete them before end of day.`,
                    priority: 'medium'
                });
            }

            // Send alerts
            for (const alert of alerts) {
                try {
                    await notificationService.send(user.id, {
                        type: alert.type,
                        title: alert.title,
                        body: alert.body,
                        data: { priority: alert.priority, date }
                    });
                } catch (e) {
                    console.error(`[LeadAlerts] Notification error for ${user.full_name}:`, e.message);
                }
            }

            // WhatsApp alert for no leads + overdue (combined message)
            if (whatsappSessionManager && user.phone && alerts.length > 0) {
                let waPhone = user.phone.replace(/[^0-9]/g, '');
                if (waPhone.length === 10) waPhone = '91' + waPhone;

                let waMsg = `*QC Paint Shop - Daily Alerts*\n---\n`;
                for (const alert of alerts) {
                    waMsg += `\n*${alert.title}*\n${alert.body}\n`;
                }
                waMsg += `\n_Auto-generated alert_`;

                try {
                    await whatsappSessionManager.sendMessage(user.branch_id || 0, waPhone, waMsg);
                } catch (err) {
                    // WhatsApp fail is OK, notification already sent
                }
            }
        }

        console.log(`[LeadAlerts] Processed ${staff.length} staff members`);
    } catch (error) {
        console.error('[LeadAlerts] sendLeadAlerts error:', error.message);
    }
}

/**
 * Start the cron jobs
 */
function start() {
    if (registry) {
        registry.register('attendance-daily-report', { name: 'Attendance Reports', service: 'attendance-report', schedule: '5 22 * * *', description: 'Daily attendance reports to staff + admin PDF at 10:05 PM' });
        registry.register('activity-daily-report', { name: 'Activity Reports', service: 'attendance-report', schedule: '5 22 * * *', description: 'Daily activity report to admin at 10:05 PM' });
        registry.register('lead-daily-alerts', { name: 'Lead Alerts', service: 'attendance-report', schedule: '5 18 * * *', description: 'Lead creation + follow-up alerts at 6:05 PM' });
    }

    // 10:05 PM IST - Attendance reports to all staff + admin PDF
    cron.schedule('5 22 * * *', async () => {
        console.log('[AttendanceReport] 10:05 PM cron triggered');
        if (registry) registry.markRunning('attendance-daily-report');
        try {
            const today = getTodayIST();
            const result = await sendAllReports(today);
            await sendAdminReport(today);
            if (registry) registry.markCompleted('attendance-daily-report', { details: `${result.sent} sent, ${result.failed} failed` });

            // Send activity report to admins
            if (registry) registry.markRunning('activity-daily-report');
            try {
                await sendActivityAdminReport(today);
                if (registry) registry.markCompleted('activity-daily-report', { details: 'Activity report sent' });
            } catch (actErr) {
                console.error('[ActivityReport] Cron error:', actErr.message);
                if (registry) registry.markFailed('activity-daily-report', { error: actErr.message });
            }
        } catch (e) {
            console.error('[AttendanceReport] Cron error:', e.message);
            if (registry) registry.markFailed('attendance-daily-report', { error: e.message });
        }
    }, { timezone: 'Asia/Kolkata' });

    // 6:05 PM IST - Lead creation + follow-up alerts
    cron.schedule('5 18 * * *', async () => {
        console.log('[LeadAlerts] 6:05 PM cron triggered');
        if (registry) registry.markRunning('lead-daily-alerts');
        try {
            const today = getTodayIST();
            await sendLeadAlerts(today);
            if (registry) registry.markCompleted('lead-daily-alerts', { details: 'Alerts sent' });
        } catch (e) {
            console.error('[LeadAlerts] Cron error:', e.message);
            if (registry) registry.markFailed('lead-daily-alerts', { error: e.message });
        }
    }, { timezone: 'Asia/Kolkata' });

    console.log('[AttendanceReport] 10:05 PM IST cron scheduled (staff + admin PDF)');
    console.log('[LeadAlerts] 6:05 PM IST cron scheduled (lead creation + followup alerts)');
}

module.exports = {
    setPool,
    setIO,
    setSessionManager,
    setAutomationRegistry,
    start,
    generateReport,
    sendReport,
    sendAllReports,
    sendAdminReport,
    generateAdminPDF,
    sendLeadAlerts,
    generateActivityReportData,
    generateActivityPDF,
    sendActivityAdminReport
};
