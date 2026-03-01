# Salary Fix + Leave Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix salary calculation display bug and add leave policy with salary deductions (1 paid Sunday leave + 1 paid weekday leave per month; excess leaves deducted from salary).

**Architecture:** Adds `leave_deduction` column to `monthly_salaries` table. Salary calculation function (`calculateSalaryForUser`) queries `attendance_permissions` for approved leaves, computes excess beyond free quota, and deducts at same rate as absence. A new `GET /api/attendance/leave-balance` endpoint provides leave status for dashboard/permission-request pages.

**Tech Stack:** Express.js, MySQL, vanilla JS frontend, existing auth-helper.js patterns.

---

## Task 1: Migration — Add `leave_deduction` column

**Files:**
- Create: `migrations/migrate-salary-leave-deduction.js`

**Step 1: Create migration file**

```js
// migrations/migrate-salary-leave-deduction.js
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Starting salary leave deduction migration...');

        // 1. Add leave_deduction column to monthly_salaries
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'leave_deduction'"
        );
        if (cols.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN leave_deduction DECIMAL(10,2) DEFAULT 0 AFTER absence_deduction");
            console.log('Added leave_deduction column to monthly_salaries');
        } else {
            console.log('leave_deduction column already exists');
        }

        // 2. Add leave tracking columns
        const leaveColumns = [
            { name: 'paid_sunday_leaves', def: "INT DEFAULT 0 AFTER total_leaves" },
            { name: 'paid_weekday_leaves', def: "INT DEFAULT 0 AFTER paid_sunday_leaves" },
            { name: 'excess_leaves', def: "INT DEFAULT 0 AFTER paid_weekday_leaves" }
        ];

        for (const col of leaveColumns) {
            const [exists] = await pool.query(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = ?",
                [col.name]
            );
            if (exists.length === 0) {
                await pool.query(`ALTER TABLE monthly_salaries ADD COLUMN ${col.name} ${col.def}`);
                console.log(`Added ${col.name} column`);
            } else {
                console.log(`${col.name} column already exists`);
            }
        }

        // 3. Update total_deductions GENERATED column to include leave_deduction
        // Note: Must drop and recreate GENERATED column
        try {
            await pool.query("ALTER TABLE monthly_salaries DROP COLUMN net_salary");
            await pool.query("ALTER TABLE monthly_salaries DROP COLUMN gross_salary");
            console.log('Dropped old GENERATED columns');
        } catch (e) {
            console.log('GENERATED columns may not exist or already dropped:', e.message);
        }

        // total_deductions is NOT generated - it's a regular column set by code
        // gross_salary and net_salary ARE generated
        try {
            await pool.query(`ALTER TABLE monthly_salaries ADD COLUMN gross_salary DECIMAL(10,2) GENERATED ALWAYS AS (
                standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances
            ) STORED`);
            await pool.query(`ALTER TABLE monthly_salaries ADD COLUMN net_salary DECIMAL(10,2) GENERATED ALWAYS AS (
                standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances - total_deductions
            ) STORED`);
            console.log('Recreated GENERATED columns');
        } catch (e) {
            console.log('GENERATED columns may already exist:', e.message);
        }

        console.log('Migration complete!');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
```

**Step 2: Run migration**

Run: `node migrations/migrate-salary-leave-deduction.js`
Expected: All columns added, GENERATED columns recreated.

**Step 3: Commit**

```bash
git add migrations/migrate-salary-leave-deduction.js
git commit -m "feat: add leave_deduction column to monthly_salaries table"
```

---

## Task 2: Fix salary calculation & add leave deduction logic

**Files:**
- Modify: `routes/salary.js:412-547` (the `calculateSalaryForUser` function)

**Step 1: Add leave query and deduction logic to `calculateSalaryForUser`**

In `routes/salary.js`, find the function `calculateSalaryForUser` at line 412. After the attendance query (line 456) and before `const att = attendanceRows[0];` (line 458), add the leave query. Then update the deductions section (lines 472-483) to include leave deduction.

Replace the entire block from line 458 (`const att = attendanceRows[0];`) through line 483 (`const totalDeductions = lateDeduction + absenceDeduction;`) with:

```js
    const att = attendanceRows[0];

    // Get approved leave count from attendance_permissions
    const [leaveRows] = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) = 1 THEN 1 ELSE 0 END), 0) as sunday_leaves,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) != 1 THEN 1 ELSE 0 END), 0) as weekday_leaves
         FROM attendance_permissions
         WHERE user_id = ? AND request_type = 'leave' AND status = 'approved'
           AND request_date BETWEEN ? AND ?`,
        [userId, fromDate, toDate]
    );

    const leaveData = leaveRows[0];
    const sundayLeaves = parseInt(leaveData.sunday_leaves) || 0;
    const weekdayLeaves = parseInt(leaveData.weekday_leaves) || 0;

    // Leave policy: 1 paid Sunday leave + 1 paid weekday leave per month
    const FREE_SUNDAY_LEAVES = 1;
    const FREE_WEEKDAY_LEAVES = 1;
    const paidSundayLeaves = Math.min(sundayLeaves, FREE_SUNDAY_LEAVES);
    const paidWeekdayLeaves = Math.min(weekdayLeaves, FREE_WEEKDAY_LEAVES);
    const excessSundayLeaves = Math.max(0, sundayLeaves - FREE_SUNDAY_LEAVES);
    const excessWeekdayLeaves = Math.max(0, weekdayLeaves - FREE_WEEKDAY_LEAVES);
    const excessLeaves = excessSundayLeaves + excessWeekdayLeaves;

    // Calculate pay components
    const standardHoursPay = parseFloat(att.standard_hours) * hourlyRate;
    const sundayHoursPay = parseFloat(att.sunday_hours) * hourlyRate;
    const overtimePay = parseFloat(att.approved_overtime_hours) * hourlyRate * overtimeMultiplier;

    // Allowances from config
    const transportAllowance = parseFloat(config.transport_allowance) || 0;
    const foodAllowance = parseFloat(config.food_allowance) || 0;
    const otherAllowance = parseFloat(config.other_allowance) || 0;
    const totalAllowances = transportAllowance + foodAllowance + otherAllowance;

    // Deductions
    let lateDeduction = 0;
    if (config.enable_late_deduction && config.late_deduction_per_hour > 0) {
        lateDeduction = parseInt(att.late_days) * parseFloat(config.late_deduction_per_hour);
    }

    let absenceDeduction = 0;
    if (config.enable_absence_deduction && parseInt(att.absent_days) > 0) {
        absenceDeduction = parseInt(att.absent_days) * hourlyRate * parseFloat(config.standard_daily_hours);
    }

    // Leave deduction: excess leaves beyond free quota
    const leaveDeduction = excessLeaves * hourlyRate * parseFloat(config.standard_daily_hours);

    const totalDeductions = lateDeduction + absenceDeduction + leaveDeduction;
```

**Step 2: Update the UPDATE SQL to include leave columns**

Replace the UPDATE query (lines 494-518) to include `leave_deduction`, `paid_sunday_leaves`, `paid_weekday_leaves`, `excess_leaves`:

```js
    let salaryId;
    if (existing.length > 0) {
        salaryId = existing[0].id;
        await pool.query(
            `UPDATE monthly_salaries SET
                branch_id = ?, from_date = ?, to_date = ?, base_salary = ?,
                total_working_days = ?, total_present_days = ?, total_absent_days = ?,
                total_half_days = ?, total_sundays_worked = ?, total_leaves = ?,
                paid_sunday_leaves = ?, paid_weekday_leaves = ?, excess_leaves = ?,
                total_standard_hours = ?, total_sunday_hours = ?, total_overtime_hours = ?,
                total_worked_hours = ?,
                standard_hours_pay = ?, sunday_hours_pay = ?, overtime_pay = ?,
                transport_allowance = ?, food_allowance = ?, other_allowance = ?,
                total_allowances = ?,
                late_deduction = ?, absence_deduction = ?, leave_deduction = ?,
                total_deductions = ?,
                status = 'calculated', calculation_date = NOW(), calculated_by = ?
             WHERE id = ?`,
            [
                config.branch_id, fromDate, toDate, config.monthly_salary,
                parseInt(att.total_days), parseInt(att.present_days), parseInt(att.absent_days),
                parseInt(att.half_days), parseInt(att.sundays_worked), parseInt(att.leaves),
                paidSundayLeaves, paidWeekdayLeaves, excessLeaves,
                parseFloat(att.standard_hours), parseFloat(att.sunday_hours), parseFloat(att.overtime_hours),
                parseFloat(att.standard_hours) + parseFloat(att.sunday_hours) + parseFloat(att.overtime_hours),
                standardHoursPay, sundayHoursPay, overtimePay,
                transportAllowance, foodAllowance, otherAllowance, totalAllowances,
                lateDeduction, absenceDeduction, leaveDeduction,
                totalDeductions,
                calculatedBy, salaryId
            ]
        );
    }
```

**Step 3: Update the INSERT SQL similarly**

Replace the INSERT query (lines 520-543):

```js
    else {
        const [result] = await pool.query(
            `INSERT INTO monthly_salaries (
                user_id, branch_id, salary_month, from_date, to_date, base_salary,
                total_working_days, total_present_days, total_absent_days,
                total_half_days, total_sundays_worked, total_leaves,
                paid_sunday_leaves, paid_weekday_leaves, excess_leaves,
                total_standard_hours, total_sunday_hours, total_overtime_hours, total_worked_hours,
                standard_hours_pay, sunday_hours_pay, overtime_pay,
                transport_allowance, food_allowance, other_allowance, total_allowances,
                late_deduction, absence_deduction, leave_deduction, total_deductions,
                status, calculation_date, calculated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated', NOW(), ?)`,
            [
                userId, config.branch_id, month, fromDate, toDate, config.monthly_salary,
                parseInt(att.total_days), parseInt(att.present_days), parseInt(att.absent_days),
                parseInt(att.half_days), parseInt(att.sundays_worked), parseInt(att.leaves),
                paidSundayLeaves, paidWeekdayLeaves, excessLeaves,
                parseFloat(att.standard_hours), parseFloat(att.sunday_hours), parseFloat(att.overtime_hours),
                parseFloat(att.standard_hours) + parseFloat(att.sunday_hours) + parseFloat(att.overtime_hours),
                standardHoursPay, sundayHoursPay, overtimePay,
                transportAllowance, foodAllowance, otherAllowance, totalAllowances,
                lateDeduction, absenceDeduction, leaveDeduction, totalDeductions,
                calculatedBy
            ]
        );
        salaryId = result.insertId;
    }
```

**Step 4: Improve error logging in calculate-all**

In `routes/salary.js`, find the `calculate-all` route (line 591). Update the catch block inside the for loop (line 633-638) to log more detail:

```js
            } catch (err) {
                console.error(`Salary calculation failed for user ${s.user_id}:`, err.message);
                results.push({
                    user_id: s.user_id,
                    success: false,
                    error: err.message
                });
            }
```

**Step 5: Commit**

```bash
git add routes/salary.js
git commit -m "feat: add leave deduction to salary calculation (1 paid Sunday + 1 paid weekday per month)"
```

---

## Task 3: Fix admin-salary-monthly.html display bug

**Files:**
- Modify: `public/admin-salary-monthly.html`

The frontend code at line 671 checks `result.data.length > 0` — this works correctly. The likely issue is that `loadSalaries()` runs on page load but the `calculate-all` response includes individual results that the user doesn't see failures for.

**Step 1: Add error display to calculateSalaries function**

In `public/admin-salary-monthly.html`, replace the `calculateSalaries()` function (lines 909-943) with improved version that shows individual errors:

```js
        async function calculateSalaries() {
            const token = localStorage.getItem('auth_token');
            const month = document.getElementById('calculateMonth').value;
            const branchId = document.getElementById('calculateBranch').value;

            if (!month) {
                alert('Please select a month');
                return;
            }

            if (!confirm('Calculate salaries for ' + month + '?')) return;

            const data = { month };
            if (branchId) data.branch_id = parseInt(branchId);

            try {
                const response = await fetch(`${API_BASE}/api/salary/calculate-all`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    const successCount = result.data.filter(r => r.success).length;
                    const failCount = result.data.filter(r => !r.success).length;
                    let msg = `Calculated salaries: ${successCount} success`;
                    if (failCount > 0) {
                        const errors = result.data.filter(r => !r.success).map(r => r.error).join('\n');
                        msg += `, ${failCount} failed:\n${errors}`;
                    }
                    alert(msg);
                    closeCalculateModal();
                    document.getElementById('filterMonth').value = month;
                    loadSalaries();
                } else {
                    alert('Error: ' + result.message);
                }
            } catch (err) {
                alert('Network error: ' + err.message);
            }
        }
```

**Step 2: Add try-catch to loadSalaries**

In `public/admin-salary-monthly.html`, wrap the `loadSalaries()` function (lines 640-679) with proper try-catch:

```js
        async function loadSalaries() {
            const token = localStorage.getItem('auth_token');
            const month = document.getElementById('filterMonth').value;

            if (!month) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
                return;
            }

            const branchId = document.getElementById('filterBranch').value;
            const status = document.getElementById('filterStatus').value;
            const paymentStatus = document.getElementById('filterPaymentStatus').value;

            document.getElementById('loading').style.display = 'block';
            document.getElementById('tableContent').style.display = 'none';
            document.getElementById('emptyState').style.display = 'none';

            try {
                let url = `${API_BASE}/api/salary/monthly?month=${month}`;
                if (branchId) url += `&branch_id=${branchId}`;
                if (status) url += `&status=${status}`;
                if (paymentStatus) url += `&payment_status=${paymentStatus}`;

                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const result = await response.json();

                document.getElementById('loading').style.display = 'none';

                if (result.success && result.data && result.data.length > 0) {
                    renderSalaries(result.data);
                    updateSummary(result.data);
                    document.getElementById('tableContent').style.display = 'block';
                } else {
                    document.getElementById('emptyState').style.display = 'block';
                    updateSummary([]);
                }
            } catch (err) {
                console.error('Error loading salaries:', err);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
                updateSummary([]);
            }
        }
```

**Step 3: Add leave deduction to the detail modal**

In `public/admin-salary-monthly.html`, in the `renderSalaryDetails` function (line 772), find the Deductions section (around line 853). Add leave deduction row after absence deduction:

Find this block:
```html
                        <div class="detail-row">
                            <span>Absence Deduction:</span>
                            <strong class="money negative">₹${parseFloat(s.absence_deduction || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Other Deduction:</span>
```

Replace with:
```html
                        <div class="detail-row">
                            <span>Absence Deduction:</span>
                            <strong class="money negative">₹${parseFloat(s.absence_deduction || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Leave Deduction (${s.excess_leaves || 0} excess days):</span>
                            <strong class="money negative">₹${parseFloat(s.leave_deduction || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Other Deduction:</span>
```

**Step 4: Add leave info to the Attendance Summary section**

In the same `renderSalaryDetails` function, find the "Attendance Summary" section. After the "Sundays Worked" row, add leave info:

Find:
```html
                        <div class="detail-row">
                            <span>Sundays Worked:</span>
                            <strong>${s.total_sundays_worked || 0}</strong>
                        </div>
```

Add after it:
```html
                        <div class="detail-row">
                            <span>Paid Leaves (Sun/Wkday):</span>
                            <strong>${s.paid_sunday_leaves || 0} / ${s.paid_weekday_leaves || 0}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Excess Leaves (deducted):</span>
                            <strong style="color: ${(s.excess_leaves || 0) > 0 ? '#dc3545' : '#28a745'};">${s.excess_leaves || 0}</strong>
                        </div>
```

**Step 5: Commit**

```bash
git add public/admin-salary-monthly.html
git commit -m "fix: improve salary display error handling and add leave deduction details"
```

---

## Task 4: Add leave-balance endpoint to attendance routes

**Files:**
- Modify: `routes/attendance.js` (add endpoint before `module.exports`)

**Step 1: Add leave-balance endpoint**

In `routes/attendance.js`, find the line `module.exports = {` at the end of the file. Add the following endpoint BEFORE that line:

```js
// ========================================
// LEAVE BALANCE
// ========================================

/**
 * GET /api/attendance/leave-balance
 * Returns current month leave usage for the authenticated user
 */
router.get('/leave-balance', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { month } = req.query;

        // Default to current month
        const now = new Date();
        const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const fromDate = `${targetMonth}-01`;
        const toDate = new Date(parseInt(targetMonth.split('-')[0]), parseInt(targetMonth.split('-')[1]), 0)
            .toISOString().split('T')[0];

        // Count approved leaves from attendance_permissions
        const [leaveRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) = 1 THEN 1 ELSE 0 END), 0) as sunday_leaves,
                COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) != 1 THEN 1 ELSE 0 END), 0) as weekday_leaves
             FROM attendance_permissions
             WHERE user_id = ? AND request_type = 'leave' AND status = 'approved'
               AND request_date BETWEEN ? AND ?`,
            [userId, fromDate, toDate]
        );

        // Count pending leave requests too
        const [pendingRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) = 1 THEN 1 ELSE 0 END), 0) as sunday_pending,
                COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) != 1 THEN 1 ELSE 0 END), 0) as weekday_pending
             FROM attendance_permissions
             WHERE user_id = ? AND request_type = 'leave' AND status = 'pending'
               AND request_date BETWEEN ? AND ?`,
            [userId, fromDate, toDate]
        );

        const data = leaveRows[0];
        const pending = pendingRows[0];
        const sundayUsed = parseInt(data.sunday_leaves) || 0;
        const weekdayUsed = parseInt(data.weekday_leaves) || 0;
        const sundayPending = parseInt(pending.sunday_pending) || 0;
        const weekdayPending = parseInt(pending.weekday_pending) || 0;

        const FREE_SUNDAY = 1;
        const FREE_WEEKDAY = 1;

        res.json({
            success: true,
            data: {
                month: targetMonth,
                sunday: {
                    free: FREE_SUNDAY,
                    used: sundayUsed,
                    pending: sundayPending,
                    remaining: Math.max(0, FREE_SUNDAY - sundayUsed)
                },
                weekday: {
                    free: FREE_WEEKDAY,
                    used: weekdayUsed,
                    pending: weekdayPending,
                    remaining: Math.max(0, FREE_WEEKDAY - weekdayUsed)
                },
                total_excess: Math.max(0, sundayUsed - FREE_SUNDAY) + Math.max(0, weekdayUsed - FREE_WEEKDAY),
                will_be_deducted: (Math.max(0, sundayUsed - FREE_SUNDAY) + Math.max(0, weekdayUsed - FREE_WEEKDAY)) > 0
            }
        });

    } catch (error) {
        console.error('Error fetching leave balance:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch leave balance' });
    }
});
```

**Important:** This route MUST be placed BEFORE any `/:id` parameterized routes to avoid conflicts. Place it right before `module.exports`.

**Step 2: Commit**

```bash
git add routes/attendance.js
git commit -m "feat: add leave-balance endpoint for staff leave quota tracking"
```

---

## Task 5: Add leave balance card to staff dashboard

**Files:**
- Modify: `public/staff/dashboard.html`

**Step 1: Add leave balance card after the Quick Actions section**

In `public/staff/dashboard.html`, find the Quick Actions section (line 767). After the closing `</div>` of the Quick Actions card (around line 820), add the leave balance card:

```html
    <!-- Leave Balance Card -->
    <div class="status-card" id="leaveBalanceCard" style="display: none;">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #1f2937;">
            <span style="margin-right: 8px;">📅</span>Leave Balance This Month
        </h3>
        <div id="leaveBalanceContent">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                <div style="background: #f0f9ff; border-radius: 12px; padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: #0369a1; font-weight: 600; margin-bottom: 4px;">Sunday Paid Leave</div>
                    <div id="sundayLeaveStatus" style="font-size: 24px; font-weight: 700; color: #0c4a6e;">-</div>
                    <div id="sundayLeaveLabel" style="font-size: 11px; color: #6b7280; margin-top: 4px;">Loading...</div>
                </div>
                <div style="background: #fefce8; border-radius: 12px; padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: #a16207; font-weight: 600; margin-bottom: 4px;">Weekday Paid Leave</div>
                    <div id="weekdayLeaveStatus" style="font-size: 24px; font-weight: 700; color: #713f12;">-</div>
                    <div id="weekdayLeaveLabel" style="font-size: 11px; color: #6b7280; margin-top: 4px;">Loading...</div>
                </div>
            </div>
            <div id="leaveWarning" style="display: none; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; text-align: center;">
                <span style="color: #dc2626; font-size: 13px; font-weight: 500;">
                    <span style="margin-right: 4px;">⚠️</span>
                    <span id="leaveWarningText">Extra leaves will be deducted from salary</span>
                </span>
            </div>
        </div>
    </div>
```

**Step 2: Add leave balance loading function**

In the `<script>` section of `public/staff/dashboard.html`, add the `loadLeaveBalance()` function and call it from the initialization code. Find where other functions like `loadAttendance()` or `updateUI()` are called and add:

```js
        async function loadLeaveBalance() {
            try {
                const res = await fetch('/api/attendance/leave-balance', { headers: getAuthHeaders() });
                const data = await res.json();

                if (data.success) {
                    const card = document.getElementById('leaveBalanceCard');
                    card.style.display = 'block';

                    const lb = data.data;

                    // Sunday leave
                    const sunEl = document.getElementById('sundayLeaveStatus');
                    const sunLabel = document.getElementById('sundayLeaveLabel');
                    sunEl.textContent = `${lb.sunday.used}/${lb.sunday.free}`;
                    sunEl.style.color = lb.sunday.remaining > 0 ? '#10b981' : '#ef4444';
                    sunLabel.textContent = lb.sunday.remaining > 0 ? `${lb.sunday.remaining} remaining` : 'Used';
                    if (lb.sunday.pending > 0) sunLabel.textContent += ` (${lb.sunday.pending} pending)`;

                    // Weekday leave
                    const wkEl = document.getElementById('weekdayLeaveStatus');
                    const wkLabel = document.getElementById('weekdayLeaveLabel');
                    wkEl.textContent = `${lb.weekday.used}/${lb.weekday.free}`;
                    wkEl.style.color = lb.weekday.remaining > 0 ? '#10b981' : '#ef4444';
                    wkLabel.textContent = lb.weekday.remaining > 0 ? `${lb.weekday.remaining} remaining` : 'Used';
                    if (lb.weekday.pending > 0) wkLabel.textContent += ` (${lb.weekday.pending} pending)`;

                    // Warning
                    if (lb.will_be_deducted) {
                        document.getElementById('leaveWarning').style.display = 'block';
                        document.getElementById('leaveWarningText').textContent =
                            `${lb.total_excess} extra leave(s) will be deducted from your salary`;
                    }
                }
            } catch (e) {
                console.error('Error loading leave balance:', e);
            }
        }
```

Then call `loadLeaveBalance()` from wherever the dashboard initialization happens. Look for code like `loadAttendanceStatus()` or `init()` and add the call alongside it.

**Step 3: Commit**

```bash
git add public/staff/dashboard.html
git commit -m "feat: add leave balance card to staff dashboard"
```

---

## Task 6: Show leave info on permission-request page

**Files:**
- Modify: `public/staff/permission-request.html`

**Step 1: Add leave balance info section**

In `public/staff/permission-request.html`, find the request form `<form id="requestForm">` (line 190). After the Request Type dropdown `</div>` (line 201), add a leave balance info panel:

```html
                <!-- Leave Balance Info (shown when 'leave' type selected) -->
                <div id="leaveBalanceInfo" style="display: none; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                    <div style="font-size: 13px; font-weight: 600; color: #0369a1; margin-bottom: 8px;">Leave Balance This Month</div>
                    <div style="display: flex; gap: 16px; margin-bottom: 8px;">
                        <div><span style="color: #6b7280;">Sunday:</span> <strong id="lbSunday">-</strong></div>
                        <div><span style="color: #6b7280;">Weekday:</span> <strong id="lbWeekday">-</strong></div>
                    </div>
                    <div id="lbWarning" style="display: none; font-size: 12px; color: #dc2626; font-weight: 500; background: #fef2f2; padding: 8px; border-radius: 8px;">
                        ⚠️ This leave will be deducted from your salary
                    </div>
                </div>
```

**Step 2: Add event listener and fetch logic**

In the `<script>` section, add the leave balance logic. After the `init()` function (around line 267):

```js
        // Leave balance tracking
        let leaveBalance = null;

        async function loadLeaveBalance() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/attendance/leave-balance', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.success) {
                    leaveBalance = data.data;
                    updateLeaveBalanceDisplay();
                }
            } catch (e) {
                console.error('Error loading leave balance:', e);
            }
        }

        function updateLeaveBalanceDisplay() {
            if (!leaveBalance) return;
            const lb = leaveBalance;
            document.getElementById('lbSunday').textContent = `${lb.sunday.used}/${lb.sunday.free} used`;
            document.getElementById('lbSunday').style.color = lb.sunday.remaining > 0 ? '#10b981' : '#ef4444';
            document.getElementById('lbWeekday').textContent = `${lb.weekday.used}/${lb.weekday.free} used`;
            document.getElementById('lbWeekday').style.color = lb.weekday.remaining > 0 ? '#10b981' : '#ef4444';

            // Check if selected date's leave would exceed quota
            checkLeaveWarning();
        }

        function checkLeaveWarning() {
            if (!leaveBalance) return;
            const requestDate = document.getElementById('requestDate').value;
            if (!requestDate) return;

            const dayOfWeek = new Date(requestDate).getDay(); // 0 = Sunday
            const isSunday = dayOfWeek === 0;
            const warning = document.getElementById('lbWarning');

            if (isSunday && leaveBalance.sunday.remaining <= 0) {
                warning.style.display = 'block';
                warning.textContent = '⚠️ Sunday paid leave used. This leave will be deducted from your salary.';
            } else if (!isSunday && leaveBalance.weekday.remaining <= 0) {
                warning.style.display = 'block';
                warning.textContent = '⚠️ Weekday paid leave used. This leave will be deducted from your salary.';
            } else {
                warning.style.display = 'none';
            }
        }

        // Show/hide leave balance when request type changes
        document.getElementById('requestType').addEventListener('change', function() {
            const leaveInfo = document.getElementById('leaveBalanceInfo');
            if (this.value === 'leave') {
                leaveInfo.style.display = 'block';
                if (!leaveBalance) loadLeaveBalance();
                else updateLeaveBalanceDisplay();
            } else {
                leaveInfo.style.display = 'none';
            }
        });

        // Re-check warning when date changes
        document.getElementById('requestDate').addEventListener('change', function() {
            if (document.getElementById('requestType').value === 'leave') {
                checkLeaveWarning();
            }
        });

        // Load leave balance on init (prefetch)
        loadLeaveBalance();
```

**Step 3: Commit**

```bash
git add public/staff/permission-request.html
git commit -m "feat: show leave balance and salary deduction warning on permission request page"
```

---

## Task 7: Show leave deduction in staff salary page

**Files:**
- Modify: `public/staff/salary.html`

**Step 1: Add leave deduction row to monthly summary**

In `public/staff/salary.html`, find the `loadMonthly()` function's HTML template (lines 227-242). Find the line:

```js
                        <div class="info-row"><span style="color:#6b7280;">Deductions</span><span style="font-weight:600;color:#ef4444;">-${formatCurrency(s.total_deductions)}</span></div>
```

Replace with (add leave deduction breakdown before total deductions):

```js
                        ${parseFloat(s.leave_deduction || 0) > 0 ? `<div class="info-row"><span style="color:#6b7280;">Leave Deduction (${s.excess_leaves || 0} days)</span><span style="font-weight:600;color:#ef4444;">-${formatCurrency(s.leave_deduction)}</span></div>` : ''}
                        <div class="info-row"><span style="color:#6b7280;">Total Deductions</span><span style="font-weight:600;color:#ef4444;">-${formatCurrency(s.total_deductions)}</span></div>
```

**Step 2: Add leave balance card to salary page**

Find the "Payment History" card (line 138). After it, before the `<script>` tag, add:

```html
    <!-- Leave Balance Card -->
    <div id="leaveBalanceCard" class="card" style="display: none;">
        <div class="section-title">Leave Balance</div>
        <div id="leaveBalanceContent">
            <div class="info-row">
                <span style="color:#6b7280;">Sunday Paid Leave</span>
                <span id="salSundayLeave" style="font-weight:600;">-</span>
            </div>
            <div class="info-row">
                <span style="color:#6b7280;">Weekday Paid Leave</span>
                <span id="salWeekdayLeave" style="font-weight:600;">-</span>
            </div>
            <div id="salLeaveWarning" style="display: none; margin-top: 8px; background: #fef2f2; border-radius: 8px; padding: 10px; text-align: center;">
                <span style="color: #dc2626; font-size: 13px; font-weight: 500;" id="salLeaveWarningText"></span>
            </div>
        </div>
    </div>
```

**Step 3: Add leave balance fetch in the script**

In the `<script>` section, add a function after `loadPayments()` (line 313):

```js
        async function loadLeaveBalance() {
            try {
                const res = await fetch(`/api/attendance/leave-balance?month=${currentMonth}`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    const card = document.getElementById('leaveBalanceCard');
                    card.style.display = 'block';
                    const lb = data.data;

                    const sunEl = document.getElementById('salSundayLeave');
                    sunEl.textContent = `${lb.sunday.used}/${lb.sunday.free} used`;
                    sunEl.style.color = lb.sunday.remaining > 0 ? '#10b981' : '#ef4444';

                    const wkEl = document.getElementById('salWeekdayLeave');
                    wkEl.textContent = `${lb.weekday.used}/${lb.weekday.free} used`;
                    wkEl.style.color = lb.weekday.remaining > 0 ? '#10b981' : '#ef4444';

                    if (lb.will_be_deducted) {
                        document.getElementById('salLeaveWarning').style.display = 'block';
                        document.getElementById('salLeaveWarningText').textContent =
                            `⚠️ ${lb.total_excess} excess leave(s) will be deducted from salary`;
                    }
                }
            } catch (e) {
                console.error('Error loading leave balance:', e);
            }
        }
```

**Step 4: Call loadLeaveBalance from loadAll and changeMonth**

Find `loadAll()` (line 180) and add `loadLeaveBalance()` to the Promise.all:

```js
        async function loadAll() {
            document.getElementById('monthLabel').textContent = formatMonth(currentMonth);
            await Promise.all([loadConfig(), loadMonthly(), loadHistory(), loadPayments(), loadLeaveBalance()]);
            document.getElementById('loadingState').style.display = 'none';
        }
```

Also find `changeMonth()` (line 161) and add loadLeaveBalance call:

```js
        function changeMonth(delta) {
            const [y, m] = currentMonth.split('-').map(Number);
            const d = new Date(y, m - 1 + delta);
            currentMonth = d.toISOString().slice(0, 7);
            document.getElementById('monthLabel').textContent = formatMonth(currentMonth);
            loadMonthly();
            loadLeaveBalance();
        }
```

**Step 5: Commit**

```bash
git add public/staff/salary.html
git commit -m "feat: show leave deduction details and balance on staff salary page"
```

---

## Task 8: Test and verify end-to-end

**Step 1: Run migration on server**

```bash
node migrations/migrate-salary-leave-deduction.js
```
Expected: All columns added successfully.

**Step 2: Test salary calculation**

1. Open admin-salary-monthly.html
2. Select month (e.g., 2026-02)
3. Click "Calculate Salaries"
4. Verify: Success message shows X success / Y failed
5. Verify: Table populates with calculated salaries
6. Click View on a salary → verify leave deduction row shows

**Step 3: Test leave balance endpoint**

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/attendance/leave-balance
```
Expected: JSON with `sunday.used`, `sunday.free`, `weekday.used`, `weekday.free`, `total_excess`.

**Step 4: Test staff dashboard**

1. Login as staff
2. Open staff dashboard
3. Verify: Leave Balance card visible with Sunday/Weekday status
4. Verify: Warning shows if leaves exceed quota

**Step 5: Test permission request page**

1. Open permission-request.html
2. Select "Leave" type
3. Verify: Leave balance panel appears
4. Select a date → check if warning shows when over quota

**Step 6: Test staff salary page**

1. Open staff/salary.html
2. Verify: Leave deduction row visible in monthly summary
3. Verify: Leave Balance card shows at bottom

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete salary fix + leave policy with deductions"
```
