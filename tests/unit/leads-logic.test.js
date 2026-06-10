/**
 * Characterization tests for the lead auto-assignment logic
 * (services/lead-auto-assign-scheduler.js::runAutoAssign).
 *
 * Locks the CURRENT behavior of the daily round-robin:
 *   - kill-switch: ai_config.lead_auto_assign_enabled must be exactly '1';
 *     anything else (including a missing row) is a no-op
 *   - balancing: each lead goes to the staffer with the fewest
 *     (existing active + assigned-this-run) leads; ties break by lower user id
 *   - per-staff cap: ai_config.lead_auto_assign_leads_per_staff (default 10)
 *     limits assignments PER RUN; overflow leads are counted as skipped
 *   - a branch with no active staff skips all of its leads
 *   - notifications are consolidated: one send() per staffer, body lists the
 *     first 3 lead names then "and N more"
 *
 * Pure node test: pool mocked with SQL-regex routing (house style),
 * notification-service mocked.
 */

jest.mock('../../services/notification-service', () => ({
    send: jest.fn(async () => {})
}));

const notificationService = require('../../services/notification-service');
const scheduler = require('../../services/lead-auto-assign-scheduler');

/**
 * House-style pool mock with SQL-regex routing.
 * @param {Object} opts
 * @param {Object} opts.config        ai_config rows: { config_key: config_value }
 * @param {Array}  opts.leads         unassigned leads: { id, name, lead_number, branch_id }
 * @param {Object} opts.staffByBranch branchId -> [{ id, full_name, active_lead_count }]
 */
function makePool({ config = {}, leads = [], staffByBranch = {} } = {}) {
    const updates = []; // [assigned_to, lead_id] param pairs, in order
    const calls = [];
    const pool = {
        updates,
        calls,
        query: jest.fn(async (sql, params) => {
            calls.push([sql, params]);
            if (/FROM ai_config/i.test(sql)) {
                const value = config[params[0]];
                return [value !== undefined ? [{ config_value: value }] : []];
            }
            if (/FROM leads/i.test(sql) && /assigned_to IS NULL/i.test(sql)) {
                return [leads];
            }
            if (/FROM users u/i.test(sql)) {
                // fresh copies — the service sorts this array in place
                return [(staffByBranch[params[0]] || []).map(s => ({ ...s }))];
            }
            if (/UPDATE leads SET assigned_to/i.test(sql)) {
                updates.push(params);
                return [{ affectedRows: 1 }];
            }
            return [[]];
        })
    };
    return pool;
}

beforeEach(() => {
    notificationService.send.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('runAutoAssign kill-switch', () => {
    it('no-ops unless lead_auto_assign_enabled is exactly "1" (missing key counts as disabled)', async () => {
        const pool = makePool({ leads: [{ id: 1, name: 'L1', lead_number: 'LD-1', branch_id: 5 }] });
        scheduler.setPool(pool);

        await expect(scheduler.runAutoAssign()).resolves.toEqual({ assigned: 0, skipped: 0 });
        // only the config lookup ran — leads were never even fetched
        expect(pool.calls).toHaveLength(1);
        expect(pool.calls[0][1]).toEqual(['lead_auto_assign_enabled']);
        expect(pool.updates).toHaveLength(0);
    });

    it('no-ops when explicitly disabled with "0"', async () => {
        const pool = makePool({ config: { lead_auto_assign_enabled: '0' } });
        scheduler.setPool(pool);
        await expect(scheduler.runAutoAssign()).resolves.toEqual({ assigned: 0, skipped: 0 });
        expect(pool.updates).toHaveLength(0);
    });
});

describe('runAutoAssign round-robin balancing', () => {
    it('assigns each lead to the staffer with the fewest (active + this-run) leads, ties broken by lower id', async () => {
        // A(id 1) already carries 2 active leads, B(id 2) carries 0.
        const pool = makePool({
            config: { lead_auto_assign_enabled: '1' },
            leads: [
                { id: 11, name: 'L1', lead_number: 'LD-11', branch_id: 5 },
                { id: 12, name: 'L2', lead_number: 'LD-12', branch_id: 5 },
                { id: 13, name: 'L3', lead_number: 'LD-13', branch_id: 5 },
                { id: 14, name: 'L4', lead_number: 'LD-14', branch_id: 5 }
            ],
            staffByBranch: {
                5: [
                    { id: 1, full_name: 'A', active_lead_count: 2 },
                    { id: 2, full_name: 'B', active_lead_count: 0 }
                ]
            }
        });
        scheduler.setPool(pool);

        const result = await scheduler.runAutoAssign();
        expect(result).toEqual({ assigned: 4, skipped: 0 });
        // L1→B (0<2), L2→B (1<2), L3→A (2=2 tie → lower id), L4→B (2<3)
        expect(pool.updates).toEqual([
            [2, 11],
            [2, 12],
            [1, 13],
            [2, 14]
        ]);
    });

    it('caps per-staff assignments at lead_auto_assign_leads_per_staff for the run; overflow is skipped', async () => {
        const pool = makePool({
            config: { lead_auto_assign_enabled: '1', lead_auto_assign_leads_per_staff: '1' },
            leads: [
                { id: 21, name: 'L1', lead_number: 'LD-21', branch_id: 7 },
                { id: 22, name: 'L2', lead_number: 'LD-22', branch_id: 7 },
                { id: 23, name: 'L3', lead_number: 'LD-23', branch_id: 7 }
            ],
            staffByBranch: { 7: [{ id: 9, full_name: 'Solo', active_lead_count: 0 }] }
        });
        scheduler.setPool(pool);

        const result = await scheduler.runAutoAssign();
        expect(result).toEqual({ assigned: 1, skipped: 2 });
        expect(pool.updates).toEqual([[9, 21]]);
    });

    it('skips every lead in a branch that has no active staff (no updates, no notifications)', async () => {
        const pool = makePool({
            config: { lead_auto_assign_enabled: '1' },
            leads: [
                { id: 31, name: 'L1', lead_number: 'LD-31', branch_id: 3 },
                { id: 32, name: 'L2', lead_number: 'LD-32', branch_id: 3 }
            ],
            staffByBranch: {} // branch 3 returns no staff
        });
        scheduler.setPool(pool);

        const result = await scheduler.runAutoAssign();
        expect(result).toEqual({ assigned: 0, skipped: 2 });
        expect(pool.updates).toHaveLength(0);
        expect(notificationService.send).not.toHaveBeenCalled();
    });
});

describe('runAutoAssign consolidated notifications', () => {
    it('sends ONE notification per staffer: first 3 lead names + "and N more"', async () => {
        const pool = makePool({
            config: { lead_auto_assign_enabled: '1' },
            leads: [1, 2, 3, 4, 5].map(n => ({ id: 40 + n, name: `L${n}`, lead_number: `LD-4${n}`, branch_id: 8 })),
            staffByBranch: { 8: [{ id: 4, full_name: 'Solo', active_lead_count: 0 }] }
        });
        scheduler.setPool(pool);

        const result = await scheduler.runAutoAssign();
        expect(result).toEqual({ assigned: 5, skipped: 0 });
        expect(notificationService.send).toHaveBeenCalledTimes(1);
        expect(notificationService.send).toHaveBeenCalledWith(4, {
            type: 'lead_assigned',
            title: '5 New Leads Auto-Assigned',
            body: 'L1, L2, L3 and 2 more',
            data: { auto_assigned: true, count: 5 }
        });
    });
});
