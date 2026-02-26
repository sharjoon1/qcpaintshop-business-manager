/**
 * AUTO CLOCK-OUT & OVERTIME SERVICE
 *
 * 1. Every 5 minutes: check for staff who exceeded expected hours
 *    - First time: emit overtime_prompt ONCE + set ot_prompt_shown_at
 *    - If prompt shown and timeout elapsed: auto-clock-out (ot_timeout)
 *    - If OT already requested: skip
 * 2. 10 PM IST cron: force clock-out ALL remaining staff (end of day)
 * 3. Geo-auto-clockout is handled separately in routes/attendance.js
 */

const cron = require('node-cron');
const notificationService = require('./notification-service');

let pool;
let io;
let registry = null;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }
function setAutomationRegistry(r) { registry = r; }

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
 * Auto-clock-out a staff member who didn't respond to OT prompt within timeout.
 */
async function autoClockoutForOTTimeout(record, now) {
    try {
        const clockIn = new Date(record.clock_in_time);
        const elapsedMinutes = (now - clockIn) / 1000 / 60;
        const breakMinutes = record.break_duration_minutes || 0;
        const workingMinutes = Math.round(elapsedMinutes - breakMinutes);
        const expectedMinutes = (record.expected_hours || 10) * 60;
        const overtimeMinutes = Math.max(0, workingMinutes - expectedMinutes);

        // End all active periods
        await endActivePeriods(record, now);

        // Clock out with ot_timeout reason — no OT pay (not approved)
        await pool.query(
            `UPDATE staff_attendance
             SET clock_out_time = ?, total_working_minutes = ?,
                 overtime_minutes = ?, ot_approved_minutes = 0,
                 auto_clockout_type = 'ot_timeout', ot_request_status = 'none',
                 is_early_checkout = 0,
                 notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: OT timeout - no response]')
             WHERE id = ?`,
            [now, workingMinutes, overtimeMinutes, record.id]
        );

        // Insert overtime_requests row for audit trail
        await pool.query(
            `INSERT INTO overtime_requests
             (user_id, attendance_id, branch_id, request_date, requested_at,
              expected_minutes, working_minutes_at_request, status, review_notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'auto_clockout', 'No response to OT prompt within timeout')`,
            [record.user_id, record.id, record.branch_id, getTodayIST(), now,
             expectedMinutes, workingMinutes]
        );

        // Notify staff via Socket.io
        if (io) {
            io.to(`user_${record.user_id}`).emit('ot_timeout_clockout', {
                message: 'You have been automatically clocked out (no response to overtime prompt).',
                attendance_id: record.id,
                total_working_minutes: workingMinutes
            });
        }

        // Notify admins
        try {
            const [admins] = await pool.query(
                "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'"
            );
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'attendance',
                    title: 'OT Timeout Clock-Out',
                    body: `${record.full_name} auto-clocked out (no OT prompt response after ${record.ot_auto_timeout_minutes || 15} min)`,
                    data: { user_id: record.user_id, attendance_id: record.id }
                });
            }
        } catch (notifErr) {
            console.error('[OT-Timeout] Notification error:', notifErr.message);
        }

        console.log(`[OT-Timeout] ${record.full_name} auto-clocked out (no response)`);
    } catch (err) {
        console.error(`[OT-Timeout] Error clocking out ${record.full_name}:`, err.message);
    }
}

/**
 * Check for staff with geo-fence warnings that have expired (5+ minutes outside).
 * Server-side enforcement — works even if client closes browser.
 * Runs every 5 minutes alongside checkOvertimePrompts.
 */
async function checkGeoWarnings() {
    if (!pool) return;

    try {
        const now = new Date();
        const today = getTodayIST();

        // Find staff with geo_warning_started_at set > 5 minutes ago, still clocked in
        const [records] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.branch_id,
                    a.break_duration_minutes, a.break_start_time, a.break_end_time,
                    a.expected_hours, a.geo_warning_started_at, a.last_geo_distance,
                    u.full_name
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             WHERE a.date = ? AND a.clock_out_time IS NULL
               AND a.geo_warning_started_at IS NOT NULL
               AND a.geo_warning_started_at <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
            [today]
        );

        for (const record of records) {
            try {
                // Skip if on break
                if (record.break_start_time && !record.break_end_time) continue;

                // Skip if on prayer
                const [activePrayer] = await pool.query(
                    "SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
                    [record.user_id]
                );
                if (activePrayer.length > 0) continue;

                // Skip if on outside work
                const [activeOW] = await pool.query(
                    "SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
                    [record.user_id]
                );
                if (activeOW.length > 0) continue;

                // All checks passed — auto-clock-out
                const distance = record.last_geo_distance || 0;

                // End all active periods FIRST (safety — may update break_duration_minutes)
                await endActivePeriods(record, now);

                // Re-fetch break duration after ending any active periods
                const [refreshed] = await pool.query(
                    'SELECT break_duration_minutes FROM staff_attendance WHERE id = ?',
                    [record.id]
                );
                const breakMinutes = (refreshed[0] && refreshed[0].break_duration_minutes) || record.break_duration_minutes || 0;
                const clockIn = new Date(record.clock_in_time);
                const elapsedMinutes = (now - clockIn) / 1000 / 60;
                const workingMinutes = Math.round(elapsedMinutes - breakMinutes);

                const geoNote = `\n[Server auto clock-out: ${distance}m from branch - geo warning expired]`;

                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         auto_clockout_type = 'geo', auto_clockout_distance = ?,
                         geo_warning_started_at = NULL,
                         notes = CONCAT(COALESCE(notes, ''), ?)
                     WHERE id = ?`,
                    [now, workingMinutes, distance, geoNote, record.id]
                );

                // Notify staff via Socket.io
                if (io) {
                    io.to(`user_${record.user_id}`).emit('auto_clockout', {
                        type: 'geo',
                        message: `You were automatically clocked out (${distance}m from branch for 5+ minutes).`,
                        attendance_id: record.id,
                        total_working_minutes: workingMinutes
                    });
                }

                // Notify staff via notification
                try {
                    await notificationService.send(record.user_id, {
                        type: 'geo_auto_clockout',
                        title: 'Auto Clock-Out (Geo)',
                        body: `You were automatically clocked out — ${distance}m from branch for 5+ minutes.`,
                        data: { type: 'geo_auto_clockout', attendance_id: record.id, distance }
                    });
                } catch (notifErr) {
                    console.error('[Geo-Enforce] Staff notification error:', notifErr.message);
                }

                // Notify admins
                try {
                    const [admins] = await pool.query(
                        "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'"
                    );
                    for (const admin of admins) {
                        await notificationService.send(admin.id, {
                            type: 'geo_auto_clockout_admin',
                            title: 'Staff Geo Auto Clock-Out',
                            body: `${record.full_name} was auto-clocked out (${distance}m from branch, server-enforced).`,
                            data: { user_id: record.user_id, attendance_id: record.id, distance }
                        });
                    }
                } catch (notifErr) {
                    console.error('[Geo-Enforce] Admin notification error:', notifErr.message);
                }

                console.log(`[Geo-Enforce] ${record.full_name} auto-clocked out (${distance}m from branch, warning started ${record.geo_warning_started_at})`);
            } catch (err) {
                console.error(`[Geo-Enforce] Error clocking out ${record.full_name}:`, err.message);
            }
        }
    } catch (error) {
        console.error('[Geo-Enforce] Check error:', error.message);
    }
}

/**
 * Check for staff who exceeded expected hours.
 * - Emit prompt ONCE (set ot_prompt_shown_at)
 * - Auto-clock-out if timeout exceeded
 * Runs every 5 minutes.
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
                    a.overtime_acknowledged, a.ot_request_status,
                    a.ot_prompt_shown_at,
                    u.full_name,
                    COALESCE(shc.ot_auto_timeout_minutes, 15) as ot_auto_timeout_minutes
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             LEFT JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.date = ? AND a.clock_out_time IS NULL`,
            [today]
        );

        for (const record of openRecords) {
            // Skip if already has an OT request (pending/approved/rejected)
            if (record.ot_request_status && record.ot_request_status !== 'none') continue;
            // Skip if already acknowledged via old system
            if (record.overtime_acknowledged) continue;

            const clockIn = new Date(record.clock_in_time);
            const elapsedMinutes = (now - clockIn) / 1000 / 60;
            const breakMinutes = record.break_duration_minutes || 0;
            const workingMinutes = elapsedMinutes - breakMinutes;
            const expectedMinutes = (record.expected_hours || 10) * 60;

            if (workingMinutes < expectedMinutes) continue;

            // Staff has exceeded expected hours
            if (record.ot_prompt_shown_at) {
                // Prompt was already shown — check timeout
                const promptAge = (now - new Date(record.ot_prompt_shown_at)) / 1000 / 60;
                if (promptAge >= record.ot_auto_timeout_minutes) {
                    // Timeout exceeded — auto clock-out
                    await autoClockoutForOTTimeout(record, now);
                }
                // Else still within timeout — do nothing (waiting for response)
            } else {
                // First time exceeding — show prompt ONCE
                await pool.query(
                    "UPDATE staff_attendance SET ot_prompt_shown_at = ? WHERE id = ?",
                    [now, record.id]
                );

                if (io) {
                    io.to(`user_${record.user_id}`).emit('overtime_prompt', {
                        message: `You have completed ${record.expected_hours || 10} hours. Request overtime or clock out?`,
                        working_minutes: Math.round(workingMinutes),
                        expected_minutes: expectedMinutes,
                        attendance_id: record.id,
                        timeout_minutes: record.ot_auto_timeout_minutes
                    });
                }

                console.log(`[Overtime] Prompt sent to ${record.full_name} (timeout: ${record.ot_auto_timeout_minutes}min)`);
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
                    a.ot_request_status, a.ot_request_id,
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

                // Determine ot_approved_minutes based on request status
                let otApprovedMinutes = 0;
                if (record.ot_request_id) {
                    const [otReq] = await pool.query(
                        "SELECT status FROM overtime_requests WHERE id = ? LIMIT 1",
                        [record.ot_request_id]
                    );
                    if (otReq.length > 0 && otReq[0].status === 'approved') {
                        otApprovedMinutes = overtimeMinutes;
                        // Update approved_minutes on the request
                        await pool.query(
                            "UPDATE overtime_requests SET approved_minutes = ? WHERE id = ?",
                            [overtimeMinutes, record.ot_request_id]
                        );
                    }
                    // Expire pending requests
                    if (otReq.length > 0 && otReq[0].status === 'pending') {
                        await pool.query(
                            "UPDATE overtime_requests SET status = 'expired', review_notes = '10 PM end-of-day expiry' WHERE id = ?",
                            [record.ot_request_id]
                        );
                    }
                }

                // Clock out with end_of_day reason
                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         overtime_minutes = ?, ot_approved_minutes = ?,
                         auto_clockout_type = 'end_of_day',
                         is_early_checkout = 0,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: 10 PM end of day]')
                     WHERE id = ?`,
                    [now, workingMinutes, overtimeMinutes, otApprovedMinutes, record.id]
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

                console.log(`[Auto-clockout] 10PM: ${record.full_name} - ${workingMinutes}min worked, ${overtimeMinutes}min OT, ${otApprovedMinutes}min approved`);
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
    // Register automations
    if (registry) {
        registry.register('auto-clockout-ot-check', { name: 'OT Prompt Check', service: 'auto-clockout', schedule: 'Every 5 min', description: 'Check for overtime prompts' });
        registry.register('auto-clockout-geo-enforce', { name: 'Geo-Fence Enforce', service: 'auto-clockout', schedule: 'Every 5 min', description: 'Server-side geo-fence auto clock-out' });
        registry.register('auto-clockout-force', { name: 'Force Clock-out', service: 'auto-clockout', schedule: '59 21 * * *', description: '10 PM force clock-out all staff' });
    }

    // Check overtime prompts every 5 minutes
    checkOvertimePrompts();
    setInterval(checkOvertimePrompts, 5 * 60 * 1000);
    console.log('[Auto-clockout] Overtime check started (every 5 min)');

    // Check geo-fence warnings every 5 minutes (server-side enforcement)
    checkGeoWarnings();
    setInterval(checkGeoWarnings, 5 * 60 * 1000);
    console.log('[Auto-clockout] Geo-fence enforcement started (every 5 min)');

    // Force clock-out at 10 PM IST (21:59 to run just before reports at 22:00)
    cron.schedule('59 21 * * *', async () => {
        console.log('[Auto-clockout] 10 PM cron triggered');
        if (registry) registry.markRunning('auto-clockout-force');
        try {
            await forceClockoutAll();
            if (registry) registry.markCompleted('auto-clockout-force', { details: 'Force clock-out done' });
        } catch (e) {
            if (registry) registry.markFailed('auto-clockout-force', { error: e.message });
        }
    }, { timezone: 'Asia/Kolkata' });
    console.log('[Auto-clockout] 10 PM IST force clock-out cron scheduled');
}

module.exports = { setPool, setIO, setAutomationRegistry, start, checkOvertimePrompts, checkGeoWarnings, forceClockoutAll, endActivePeriods };
