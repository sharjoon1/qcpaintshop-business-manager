/**
 * AUTO CLOCK-OUT & OVERTIME SERVICE
 *
 * 1. Every 5 minutes: check for staff who exceeded expected hours → emit overtime prompt (no auto-clockout)
 * 2. 10 PM IST cron: force clock-out ALL remaining staff (end of day)
 * 3. Geo-auto-clockout is handled separately in routes/attendance.js
 */

const cron = require('node-cron');

let pool;
let io;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }

/**
 * Get today's date in IST (YYYY-MM-DD)
 */
function getTodayIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    return istNow.toISOString().split('T')[0];
}

/**
 * End all active periods (break, prayer, outside work) for a staff attendance record.
 * Reused by both force clock-out and any other auto-clockout scenario.
 */
async function endActivePeriods(record, now) {
    // End active break if any
    await pool.query(
        `UPDATE staff_attendance
         SET break_end_time = ?,
             break_duration_minutes = TIMESTAMPDIFF(MINUTE, break_start_time, ?)
         WHERE id = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL`,
        [now, now, record.id]
    );

    // End active prayer period if any
    const [activePrayer] = await pool.query(
        "SELECT * FROM prayer_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
        [record.user_id]
    );
    if (activePrayer.length > 0) {
        const pp = activePrayer[0];
        const prayerDur = Math.round((now - new Date(pp.start_time)) / 1000 / 60);
        await pool.query(
            `UPDATE prayer_periods SET end_time = ?, duration_minutes = ?, status = 'ended' WHERE id = ?`,
            [now, prayerDur, pp.id]
        );
        await pool.query(
            'UPDATE staff_attendance SET prayer_minutes = prayer_minutes + ? WHERE id = ?',
            [prayerDur, pp.attendance_id]
        );
    }

    // End active outside work period if any
    const [activeOW] = await pool.query(
        "SELECT * FROM outside_work_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
        [record.user_id]
    );
    if (activeOW.length > 0) {
        const ow = activeOW[0];
        const owDur = Math.round((now - new Date(ow.start_time)) / 1000 / 60);
        await pool.query(
            `UPDATE outside_work_periods SET end_time = ?, duration_minutes = ?, status = 'ended' WHERE id = ?`,
            [now, owDur, ow.id]
        );
        await pool.query(
            'UPDATE staff_attendance SET outside_work_minutes = outside_work_minutes + ? WHERE id = ?',
            [owDur, ow.attendance_id]
        );
    }
}

/**
 * Check for staff who exceeded expected hours and emit overtime prompts.
 * Runs every 5 minutes. Does NOT auto-clock-out — staff choose to continue or clock out.
 */
async function checkOvertimePrompts() {
    if (!pool) return;

    try {
        const now = new Date();
        const today = getTodayIST();

        // Find staff who clocked in today but haven't clocked out
        const [openRecords] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.branch_id,
                    a.break_duration_minutes, a.expected_hours,
                    a.overtime_acknowledged,
                    u.full_name
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND a.clock_out_time IS NULL`,
            [today]
        );

        for (const record of openRecords) {
            // Skip if already acknowledged overtime
            if (record.overtime_acknowledged) continue;

            const clockIn = new Date(record.clock_in_time);
            const elapsedMinutes = (now - clockIn) / 1000 / 60;
            const breakMinutes = record.break_duration_minutes || 0;
            const workingMinutes = elapsedMinutes - breakMinutes;
            const expectedMinutes = (record.expected_hours || 10) * 60;

            if (workingMinutes >= expectedMinutes) {
                // Emit overtime prompt via Socket.io
                if (io) {
                    io.to(`user_${record.user_id}`).emit('overtime_prompt', {
                        message: `You have completed ${record.expected_hours || 10} hours. Continue overtime or clock out?`,
                        working_minutes: Math.round(workingMinutes),
                        expected_minutes: expectedMinutes,
                        attendance_id: record.id
                    });
                }
            }
        }
    } catch (error) {
        console.error('[Overtime] Check error:', error.message);
    }
}

/**
 * Force clock-out ALL staff still clocked in (end of day at 10 PM IST).
 */
async function forceClockoutAll() {
    if (!pool) return;

    try {
        const now = new Date();
        const today = getTodayIST();

        const [openRecords] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.branch_id,
                    a.break_duration_minutes, a.expected_hours,
                    a.overtime_started_at, a.overtime_acknowledged,
                    u.full_name, u.phone
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND a.clock_out_time IS NULL`,
            [today]
        );

        if (openRecords.length === 0) {
            console.log('[Auto-clockout] No staff to clock out at 10 PM');
            return;
        }

        console.log(`[Auto-clockout] 10 PM force clock-out: ${openRecords.length} staff`);

        for (const record of openRecords) {
            try {
                const clockIn = new Date(record.clock_in_time);
                const elapsedMinutes = (now - clockIn) / 1000 / 60;
                const breakMinutes = record.break_duration_minutes || 0;
                const workingMinutes = Math.round(elapsedMinutes - breakMinutes);
                const expectedMinutes = (record.expected_hours || 10) * 60;
                const overtimeMinutes = Math.max(0, workingMinutes - expectedMinutes);

                // End all active periods
                await endActivePeriods(record, now);

                // Clock out with end_of_day reason
                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         overtime_minutes = ?, auto_clockout_type = 'end_of_day',
                         is_early_checkout = 0,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: 10 PM end of day]')
                     WHERE id = ?`,
                    [now, workingMinutes, overtimeMinutes, record.id]
                );

                // Notify staff via Socket.io
                if (io) {
                    io.to(`user_${record.user_id}`).emit('force_clockout', {
                        message: 'You have been automatically clocked out at 10 PM (end of day).',
                        attendance_id: record.id,
                        total_working_minutes: workingMinutes,
                        overtime_minutes: overtimeMinutes
                    });
                }

                console.log(`[Auto-clockout] 10PM: ${record.full_name} - ${workingMinutes}min worked, ${overtimeMinutes}min overtime`);
            } catch (err) {
                console.error(`[Auto-clockout] Error clocking out ${record.full_name}:`, err.message);
            }
        }

        console.log(`[Auto-clockout] 10 PM force clock-out completed`);
    } catch (error) {
        console.error('[Auto-clockout] Force clockout error:', error.message);
    }
}

/**
 * Start the overtime and auto clock-out schedulers
 */
function start() {
    // Check overtime prompts every 5 minutes
    checkOvertimePrompts();
    setInterval(checkOvertimePrompts, 5 * 60 * 1000);
    console.log('[Auto-clockout] Overtime check started (every 5 min)');

    // Force clock-out at 10 PM IST (21:59 to run just before reports at 22:00)
    cron.schedule('59 21 * * *', () => {
        console.log('[Auto-clockout] 10 PM cron triggered');
        forceClockoutAll();
    }, { timezone: 'Asia/Kolkata' });
    console.log('[Auto-clockout] 10 PM IST force clock-out cron scheduled');
}

module.exports = { setPool, setIO, start, checkOvertimePrompts, forceClockoutAll, endActivePeriods };
