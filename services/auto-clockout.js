/**
 * AUTO CLOCK-OUT SERVICE
 * Runs every 15 minutes to auto-clock-out staff who have exceeded max working hours.
 * Weekdays: 10 hours, Sunday: 5 hours
 */

let pool;
let io;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }

/**
 * Check and auto clock-out staff who exceeded max hours
 */
async function runAutoClockout() {
    if (!pool) return;

    try {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);
        const today = istNow.toISOString().split('T')[0];
        const dayName = istNow.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
        const isSunday = dayName === 'sunday';
        const maxMinutes = isSunday ? 300 : 600; // 5h or 10h

        // Find staff who clocked in today but haven't clocked out
        // and whose elapsed time exceeds max hours
        const [openRecords] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.branch_id,
                    a.break_duration_minutes, a.expected_hours,
                    u.full_name
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND a.clock_out_time IS NULL`,
            [today]
        );

        let autoClockouts = 0;

        for (const record of openRecords) {
            const clockIn = new Date(record.clock_in_time);
            const elapsedMinutes = (now - clockIn) / 1000 / 60;
            const breakMinutes = record.break_duration_minutes || 0;
            const workingMinutes = elapsedMinutes - breakMinutes;

            if (workingMinutes >= maxMinutes) {
                // Auto clock out
                const totalWorkingMinutes = Math.round(maxMinutes);

                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         is_early_checkout = 0,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: max ${isSunday ? '5' : '10'}h reached]')
                     WHERE id = ?`,
                    [now, totalWorkingMinutes, record.id]
                );

                // End active break if any
                await pool.query(
                    `UPDATE staff_attendance
                     SET break_end_time = ?,
                         break_duration_minutes = TIMESTAMPDIFF(MINUTE, break_start_time, ?)
                     WHERE id = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL`,
                    [now, now, record.id]
                );

                // Notify staff via Socket.io
                if (io) {
                    io.to(`user_${record.user_id}`).emit('auto_clockout', {
                        message: `You have been automatically clocked out after ${isSunday ? '5' : '10'} hours.`,
                        attendance_id: record.id
                    });
                }

                console.log(`[Auto-clockout] ${record.full_name} (ID:${record.user_id}) - ${Math.round(workingMinutes)}min worked`);
                autoClockouts++;
            }
        }

        if (autoClockouts > 0) {
            console.log(`[Auto-clockout] Clocked out ${autoClockouts} staff at ${now.toLocaleTimeString()}`);
        }
    } catch (error) {
        console.error('[Auto-clockout] Error:', error.message);
    }
}

/**
 * Start the auto clock-out scheduler (every 15 minutes)
 */
function start() {
    // Run immediately on start
    runAutoClockout();

    // Then every 15 minutes
    setInterval(runAutoClockout, 15 * 60 * 1000);
    console.log('[Auto-clockout] Scheduler started (every 15 min)');
}

module.exports = { setPool, setIO, start, runAutoClockout };
