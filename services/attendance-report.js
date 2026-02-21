/**
 * ATTENDANCE DAILY REPORT SERVICE
 * Generates daily attendance summaries and sends via WhatsApp
 * Cron: 10 PM IST daily
 */

const cron = require('node-cron');

let pool;
let io;
let whatsappSessionManager;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }
function setSessionManager(sm) { whatsappSessionManager = sm; }

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
 * Generate report data for a staff member on a date
 * Returns { text, data } or null if no attendance
 */
async function generateReport(userId, date) {
    if (!pool) return null;

    try {
        // Get attendance records for the date
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
        const shopTime = Math.max(0, totalWorking - totalOutside - totalPrayer);

        const clockIn = formatTime(staff.clock_in_time);
        const clockOut = staff.clock_out_time ? formatTime(staff.clock_out_time) : 'Still working';
        const isComplete = staff.clock_out_time ? (totalWorking >= (staff.expected_hours || 10) * 60) : false;
        const status = !staff.clock_out_time ? 'Still Working' : (isComplete ? 'Complete' : 'Incomplete');

        // Format date
        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        const text = `📋 *Daily Attendance Report*
━━━━━━━━━━━━━━━━━━━
👤 *${staff.full_name}*
🏪 ${staff.branch_name}
📅 ${dateStr}
━━━━━━━━━━━━━━━━━━━

⏰ Clock In: ${clockIn}
⏰ Clock Out: ${clockOut}

📊 *Time Breakdown:*
🏪 Shop Time: ${formatMinutes(shopTime)}
🚶 Outside Work: ${formatMinutes(totalOutside)}
🕌 Prayer: ${formatMinutes(totalPrayer)}
☕ Break: ${formatMinutes(totalBreak)}
━━━━━━━━━━━━━━━━━━━
⏱️ *Total Working: ${formatMinutes(totalWorking)}*
📌 Status: ${status}

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
                shop_time: shopTime,
                status
            }
        };
    } catch (error) {
        console.error('[AttendanceReport] generateReport error:', error.message);
        return null;
    }
}

/**
 * Send report to a single staff member
 */
async function sendReport(userId, date, sentBy) {
    if (!pool) return { success: false, message: 'Database not available' };

    try {
        const report = await generateReport(userId, date);
        if (!report) {
            return { success: false, message: 'No attendance data found' };
        }

        const phone = report.data.phone;
        if (!phone) {
            return { success: false, message: 'Staff has no phone number' };
        }

        // Format phone for WhatsApp (Indian format)
        let waPhone = phone.replace(/[^0-9]/g, '');
        if (waPhone.length === 10) waPhone = '91' + waPhone;

        let deliveryStatus = 'failed';

        // Try WhatsApp session manager first
        if (whatsappSessionManager) {
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

        // Log to database (upsert)
        await pool.query(
            `INSERT INTO attendance_daily_reports (user_id, branch_id, report_date, sent_via, sent_by, sent_at, report_text, delivery_status)
             VALUES (?, ?, ?, 'whatsapp', ?, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE sent_via = 'whatsapp', sent_by = VALUES(sent_by), sent_at = NOW(),
                report_text = VALUES(report_text), delivery_status = VALUES(delivery_status)`,
            [userId, report.data.branch_id, date, sentBy || null, report.text, deliveryStatus]
        );

        // Emit progress via Socket.io
        if (io && sentBy) {
            io.to(`user_${sentBy}`).emit('report_send_progress', {
                user_id: userId,
                full_name: report.data.full_name,
                status: deliveryStatus
            });
        }

        return {
            success: deliveryStatus === 'sent',
            message: deliveryStatus === 'sent'
                ? `Report sent to ${report.data.full_name}`
                : `Failed to send report to ${report.data.full_name} (no WhatsApp session)`,
            delivery_status: deliveryStatus
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
    if (!pool) return;

    try {
        const [staff] = await pool.query(
            `SELECT DISTINCT a.user_id
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND u.role != 'customer' AND u.phone IS NOT NULL
             ORDER BY a.user_id`,
            [date]
        );

        console.log(`[AttendanceReport] Sending reports for ${date} to ${staff.length} staff`);

        let sent = 0, failed = 0;

        for (const s of staff) {
            const result = await sendReport(s.user_id, date, sentBy);
            if (result.success) sent++;
            else failed++;

            // 2 second delay between sends to avoid rate limiting
            if (staff.indexOf(s) < staff.length - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log(`[AttendanceReport] Done: ${sent} sent, ${failed} failed`);

        // Notify the admin who triggered it
        if (io && sentBy) {
            io.to(`user_${sentBy}`).emit('report_send_complete', {
                date,
                total: staff.length,
                sent,
                failed
            });
        }
    } catch (error) {
        console.error('[AttendanceReport] sendAllReports error:', error.message);
    }
}

/**
 * Start the 10 PM IST cron job
 */
function start() {
    // Run at 10:00 PM IST every day
    cron.schedule('0 22 * * *', async () => {
        console.log('[AttendanceReport] 10 PM cron triggered - sending daily reports');
        const now = new Date();
        // Get today's date in IST
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);
        const today = istNow.toISOString().split('T')[0];
        await sendAllReports(today);
    }, { timezone: 'Asia/Kolkata' });

    console.log('[AttendanceReport] 10 PM IST cron scheduled');
}

module.exports = {
    setPool,
    setIO,
    setSessionManager,
    start,
    generateReport,
    sendReport,
    sendAllReports
};
