/**
 * §6 salary money paths — RT-039 (Sunday OT rate) and RT-040 (hourly basis).
 *
 * Drives the real calculateSalaryForUser with a mocked pool that feeds a known
 * config + attendance + leaves, and captures the monthly_salaries upsert params
 * (the computed components live at fixed positions in that param array). Owner
 * policy (2026-06-09): Sunday OT = 2x double-time; a standard day is always 10h.
 *
 * net_salary is a STORED GENERATED column — these assertions are on the INPUT
 * components (overtime_pay, absence/leave deductions) that feed it.
 */
const salary = require('../../routes/salary');

function makeSalaryPool({ config, att, leaves }) {
    const captured = {};
    return {
        captured,
        query: jest.fn(async (sql, params) => {
            if (/FROM staff_salary_config/i.test(sql)) return [[config]];
            if (/FROM staff_attendance/i.test(sql)) return [[att]];
            if (/FROM attendance_permissions/i.test(sql)) return [[leaves]];
            if (/FROM staff_incentives/i.test(sql)) return [[{ total_incentive: 0 }]];
            if (/INSERT INTO monthly_salaries/i.test(sql)) {
                captured.params = params;
                return [{ insertId: 99 }];
            }
            return [[]];
        }),
    };
}

// Positions in the monthly_salaries upsert param array (routes/salary.js).
const IDX = { overtimePay: 21, absenceDeduction: 28, leaveDeduction: 29, totalDeductions: 30 };

describe('calculateSalaryForUser money components (RT-039, RT-040)', () => {
    // monthly 26000 → hourlyRate = 26000/260 = 100 (exact).
    // standard_daily_hours = 8 (≠ 10) so the RT-040 fix is distinguishable.
    const config = {
        branch_id: 1, monthly_salary: 26000, overtime_multiplier: '1.5',
        standard_daily_hours: '8',
        transport_allowance: 0, food_allowance: 0, other_allowance: 0,
        enable_late_deduction: 0, late_deduction_per_hour: 0,
        enable_absence_deduction: 1,
    };
    // 2 actual Sunday OT hrs → sunday_overtime_hours = (120min × 2)/60 = 4 equivalent hrs.
    const att = {
        total_days: 2, present_days: 1, absent_days: 1, half_days: 0, leaves: 0,
        sundays_worked: 1, standard_hours: '0', sunday_hours: '0',
        overtime_hours: '0', sunday_overtime_hours: '4', approved_overtime_hours: '0',
        late_days: 0,
    };
    // 2 weekday leaves → 1 free + 1 excess.
    const leaves = { sunday_leaves: 0, weekday_leaves: 2 };

    it('RT-039: Sunday OT is paid at 2× (double-time), not 3×', async () => {
        const pool = makeSalaryPool({ config, att, leaves });
        salary.setPool(pool);
        await salary.calculateSalaryForUser(7, '2026-05', 1);
        // sunday_overtime_hours already carries the ×2 premium (4 equiv hrs for 2 actual).
        // 2×: 4 × hourlyRate(100) = 400.  (Bug was 3×: 4 × 100 × 1.5 = 600.)
        expect(pool.captured.params[IDX.overtimePay]).toBe(400);
    });

    it('RT-040: absence/leave deductions use a fixed 10-hr day, not config.standard_daily_hours', async () => {
        const pool = makeSalaryPool({ config, att, leaves });
        salary.setPool(pool);
        await salary.calculateSalaryForUser(7, '2026-05', 1);
        // 1 absent day × hourlyRate 100 × 10-hr day = 1000.  (Bug used config 8 → 800.)
        expect(pool.captured.params[IDX.absenceDeduction]).toBe(1000);
        // 1 excess leave × 100 × 10 = 1000.  (Bug → 800.)
        expect(pool.captured.params[IDX.leaveDeduction]).toBe(1000);
        // total = late(0) + absence(1000) + leave(1000) = 2000.
        expect(pool.captured.params[IDX.totalDeductions]).toBe(2000);
    });
});
