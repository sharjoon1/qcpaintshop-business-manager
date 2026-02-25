# Salary System Status

**Date:** 2026-02-26
**Decision:** KEEP — Feature is active with 11 staff salary configs. Empty transaction tables are expected because February's salary hasn't been calculated yet (month not ended).

## Current State

- **staff_salary_config:** 11 rows (all active staff have salary configured)
- **monthly_salaries:** 0 rows (no months calculated yet)
- **salary_adjustments:** 0 rows (no adjustments made)
- **salary_advances:** 0 rows (no advances requested)
- **salary_payments:** 0 rows (no payments recorded)
- **Routes:** Loaded in server.js at `/api/salary`
- **Staff page:** `public/staff/salary.html` (staff can view their salary)
- **Admin page:** Salary management tab with calculate/approve/pay workflow

## Why Tables Are Empty

Salary calculation is a **manual month-end process**, not automated:

1. Admin configs were set Feb 14-16, 2026
2. February 2026 hasn't ended yet — no salary to calculate
3. At month-end, admin clicks "Calculate All" to generate monthly_salaries records
4. The system then computes: base pay, attendance deductions, overtime, allowances, advances

## Workflow

```
Admin sets salary config (DONE - 11 staff)
    → Month ends
    → Admin clicks "Calculate" or "Calculate All"
    → System pulls attendance data (working days, late, OT)
    → Generates monthly_salaries record
    → Admin reviews & approves
    → Admin records payment
```

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| POST /api/salary/calculate | Calculate salary for one staff member |
| POST /api/salary/calculate-all | Calculate salaries for all staff in a month |
| GET /api/salary/monthly | List monthly salary records |
| PUT /api/salary/monthly/:id/approve | Approve a calculated salary |
| POST /api/salary/payments | Record salary payment |
| GET /api/salary/my-monthly | Staff views own salary history |

## Configuration (11 Staff)

All 11 staff have active configs with:
- Monthly salaries: Rs 12,000 to Rs 30,000
- Standard 10-hour days, 5-hour Sundays
- 1.5x overtime multiplier
- Late/absence deduction enabled
- Various allowances (Rs 0 to Rs 7,000)

## First Calculation

The first salary calculation should be run after February 28, 2026:
1. Go to Admin > Salary Management
2. Select month: February 2026
3. Click "Calculate All"
4. Review each staff member's calculated salary
5. Approve and record payments
