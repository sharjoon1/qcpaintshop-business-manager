/**
 * Lead Auto-Assign Scheduler
 * Assigns unassigned leads to branch staff daily using round-robin
 * Schedule: 8:00 AM IST daily
 */

const cron = require('node-cron');
const notificationService = require('./notification-service');

let pool = null;
let registry = null;
let io = null;
const jobs = {};

function setPool(p) { pool = p; }
function setAutomationRegistry(r) { registry = r; }
function setIO(socketIO) { io = socketIO; }

// ─── Config Helper ─────────────────────────────────────────────

async function getConfig(key) {
    if (!pool) return null;
    try {
        const [rows] = await pool.query('SELECT config_value FROM ai_config WHERE config_key = ?', [key]);
        return rows[0]?.config_value || null;
    } catch (e) {
        return null;
    }
}

// ─── Auto-Assign Logic ─────────────────────────────────────────

async function runAutoAssign() {
    try {
        const enabled = await getConfig('lead_auto_assign_enabled');
        if (enabled !== '1') {
            console.log('[Lead Auto-Assign] Disabled, skipping');
            return { assigned: 0, skipped: 0 };
        }

        const maxPerStaff = parseInt(await getConfig('lead_auto_assign_leads_per_staff') || '10', 10);

        console.log('[Lead Auto-Assign] Running auto-assignment...');
        if (registry) registry.markRunning('lead-auto-assign');

        // Get unassigned leads grouped by branch
        const [unassignedLeads] = await pool.query(
            `SELECT id, name, lead_number, branch_id
             FROM leads
             WHERE status = 'new'
               AND assigned_to IS NULL
               AND branch_id IS NOT NULL
             ORDER BY priority = 'high' DESC, priority = 'medium' DESC, created_at ASC`
        );

        if (unassignedLeads.length === 0) {
            console.log('[Lead Auto-Assign] No unassigned leads found');
            if (registry) registry.markCompleted('lead-auto-assign', { recordsProcessed: 0 });
            return { assigned: 0, skipped: 0 };
        }

        // Group leads by branch
        const byBranch = {};
        for (const lead of unassignedLeads) {
            if (!byBranch[lead.branch_id]) byBranch[lead.branch_id] = [];
            byBranch[lead.branch_id].push(lead);
        }

        let totalAssigned = 0;
        let totalSkipped = 0;
        const staffAssignments = {}; // staffId -> [leads]

        for (const [branchId, branchLeads] of Object.entries(byBranch)) {
            // Get active staff in this branch with their current active lead counts
            const [staff] = await pool.query(
                `SELECT u.id, u.full_name,
                        COUNT(l.id) as active_lead_count
                 FROM users u
                 LEFT JOIN leads l ON l.assigned_to = u.id
                    AND l.status IN ('new', 'contacted', 'interested', 'quoted', 'negotiating')
                 WHERE u.branch_id = ?
                   AND u.status = 'active'
                   AND u.role IN ('staff', 'manager')
                 GROUP BY u.id, u.full_name
                 ORDER BY active_lead_count ASC`,
                [branchId]
            );

            if (staff.length === 0) {
                totalSkipped += branchLeads.length;
                continue;
            }

            // Track how many leads we assign to each staff member in this run
            const runCounts = {};
            staff.forEach(s => { runCounts[s.id] = 0; });

            // Round-robin: assign to staff with fewest active leads
            for (const lead of branchLeads) {
                // Sort staff by (existing active + newly assigned this run), then by id for stability
                staff.sort((a, b) => {
                    const countA = a.active_lead_count + (runCounts[a.id] || 0);
                    const countB = b.active_lead_count + (runCounts[b.id] || 0);
                    return countA - countB || a.id - b.id;
                });

                // Find first staff member under daily limit
                const assignee = staff.find(s => (runCounts[s.id] || 0) < maxPerStaff);
                if (!assignee) {
                    totalSkipped++;
                    continue;
                }

                // Assign lead
                await pool.query('UPDATE leads SET assigned_to = ? WHERE id = ?', [assignee.id, lead.id]);
                runCounts[assignee.id] = (runCounts[assignee.id] || 0) + 1;
                totalAssigned++;

                // Track for consolidated notification
                if (!staffAssignments[assignee.id]) {
                    staffAssignments[assignee.id] = { name: assignee.full_name, leads: [] };
                }
                staffAssignments[assignee.id].leads.push(lead);
            }
        }

        // Send consolidated notifications
        for (const [staffId, info] of Object.entries(staffAssignments)) {
            const count = info.leads.length;
            const leadNames = info.leads.slice(0, 3).map(l => l.name).join(', ');
            const suffix = count > 3 ? ` and ${count - 3} more` : '';

            try {
                await notificationService.send(parseInt(staffId), {
                    type: 'lead_assigned',
                    title: `${count} New Lead${count > 1 ? 's' : ''} Auto-Assigned`,
                    body: `${leadNames}${suffix}`,
                    data: { auto_assigned: true, count }
                });
            } catch (notifErr) {
                console.error(`[Lead Auto-Assign] Notification error for staff ${staffId}:`, notifErr.message);
            }

            if (io) {
                io.to(`user_${staffId}`).emit('leads_auto_assigned', {
                    count,
                    lead_names: leadNames + suffix,
                    message: `${count} new lead${count > 1 ? 's' : ''} have been auto-assigned to you`
                });
            }
        }

        console.log(`[Lead Auto-Assign] Done: ${totalAssigned} assigned, ${totalSkipped} skipped`);
        if (registry) registry.markCompleted('lead-auto-assign', { recordsProcessed: totalAssigned });

        return { assigned: totalAssigned, skipped: totalSkipped };

    } catch (error) {
        console.error('[Lead Auto-Assign] Failed:', error.message);
        if (registry) registry.markFailed('lead-auto-assign', { error: error.message });
        throw error;
    }
}

// ─── Scheduler Start/Stop ────────────────────────────────────

function start() {
    if (registry) {
        registry.register('lead-auto-assign', {
            name: 'Lead Auto-Assign',
            service: 'lead-auto-assign-scheduler',
            schedule: '0 8 * * *',
            description: 'Daily auto-assignment of unassigned leads to branch staff'
        });
    }

    // Daily at 8:00 AM IST
    jobs.autoAssign = cron.schedule('0 8 * * *', runAutoAssign, { timezone: 'Asia/Kolkata' });

    console.log('[Lead Auto-Assign] Started: daily at 8:00 AM IST');
}

function stop() {
    Object.values(jobs).forEach(j => j && j.stop());
    console.log('[Lead Auto-Assign] Stopped');
}

module.exports = {
    setPool,
    setAutomationRegistry,
    setIO,
    start,
    stop,
    runAutoAssign
};
