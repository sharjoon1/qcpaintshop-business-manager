# Salary Fix + Leave Policy System Design

**Date:** 2026-03-01
**Status:** Approved

## Problem Statement

1. **Salary calculation results not visible** - After clicking "Calculate Salaries" on admin-salary-monthly.html, the table shows empty despite calculation succeeding
2. **No leave policy enforcement** - Staff can request unlimited leaves with no salary impact
3. **No leave balance visibility** - Staff dashboard doesn't show paid leave availability

## Confirmed Requirements

- **Leave Policy (same for all staff):**
  - 1 paid Sunday leave per month
  - 1 paid weekday leave per month
  - Leaves beyond these limits → salary deduction (same formula as absence deduction: `hourly_rate × standard_daily_hours`)
  - Deduction applies even if leave is admin-approved
- **Leave counting source:** `attendance_permissions` table (type='leave', status='approved')
- **Deduction formula:** Same as existing absence deduction

## Design

### Part A: Salary Bug Fix

**Investigation areas:**
1. Check `monthly_salaries` table schema — GENERATED columns (`gross_salary`, `net_salary`) may cause INSERT failures silently
2. Check `staff_salary_config.effective_from` dates vs selected month
3. Add proper error handling to `calculateSalaryForUser()` to surface errors
4. Check if the frontend `loadSalaries()` fires correctly after calculation

### Part B: Leave Policy in Salary Calculation

**Approach:** Integrate leave counting into existing `calculateSalaryForUser()` function

**Data source:**
```sql
SELECT
  COUNT(*) as total_leaves,
  SUM(CASE WHEN DAYOFWEEK(request_date) = 1 THEN 1 ELSE 0 END) as sunday_leaves,
  SUM(CASE WHEN DAYOFWEEK(request_date) != 1 THEN 1 ELSE 0 END) as weekday_leaves
FROM attendance_permissions
WHERE user_id = ?
  AND request_type = 'leave'
  AND status = 'approved'
  AND request_date BETWEEN ? AND ?
```

**Deduction calculation:**
```
free_sunday_leaves = 1
free_weekday_leaves = 1
excess_sunday_leaves = MAX(0, sunday_leaves - free_sunday_leaves)
excess_weekday_leaves = MAX(0, weekday_leaves - free_weekday_leaves)
total_excess_leaves = excess_sunday_leaves + excess_weekday_leaves
leave_deduction = total_excess_leaves × hourly_rate × standard_daily_hours
```

**Schema change:** Add `leave_deduction` column to `monthly_salaries` table, include in `total_deductions` calculation.

### Part C: Staff Dashboard Leave Info

**Show on staff dashboard and permission-request page:**
- "Leave Balance This Month" card
- Sunday Paid Leave: X/1 used (green/red indicator)
- Weekday Paid Leave: X/1 used (green/red indicator)
- Warning text for excess leaves

**New endpoint:** `GET /api/attendance/leave-balance` — returns current month leave usage

### Part D: Leave Info on Permission Request Page

When staff selects "leave" type:
- Show current leave balance inline
- Warning if requesting beyond free quota: "This leave will be deducted from your salary"

## Files to Modify

- `routes/salary.js` — Fix calculation + add leave deduction logic
- `routes/attendance.js` — Add leave-balance endpoint
- `public/admin-salary-monthly.html` — Debug/fix display issue
- `public/staff/dashboard.html` — Add leave balance card
- `public/staff/permission-request.html` — Show leave balance when requesting leave
- `public/staff/salary.html` — Show leave deductions in salary details
- Migration script for `leave_deduction` column

## No New Tables

Reuses existing `attendance_permissions` table for leave counting. No new tables needed.
